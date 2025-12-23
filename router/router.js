import express from "express"
import { KubeConfig, KubernetesObjectApi, CoreV1Api } from "@kubernetes/client-node"
import yaml from "js-yaml"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import "dotenv/config"
import { client as redis } from "./services/redis.js"
import { admin } from "./services/firebase.js"
import { createProxyMiddleware } from "http-proxy-middleware";
import cors from "cors"
import { randomBytes } from "node:crypto"
import { v4 as uuidv4 } from "uuid"
import { Readable } from "node:stream"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Kubernetes setup
const kc = new KubeConfig()
kc.loadFromDefault()
const k8sApi = KubernetesObjectApi.makeApiClient(kc)

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cors())

async function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1]

    if (!token) {
        return res.status(401).json({
            error: "Session token missing"
        })
    }

    try {
        const decoded = await admin.auth().verifyIdToken(token)
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({
            error: "Invalid token"
        })
    }
}

async function copySecretsToNamespace(kc, targetNamespace) {
    const coreApi = kc.makeApiClient(CoreV1Api);
    const secretsToCopy = ["spectra-secret", "spectra-env-secret"];

    for (const secretName of secretsToCopy) {
        try {
            console.log('Attempting to read secret:', { secretName });
            const secret = await coreApi.readNamespacedSecret({
                name: secretName,
                namespace: "default"
            });

            delete secret.metadata.resourceVersion;
            delete secret.metadata.uid;
            secret.metadata.namespace = targetNamespace;
            secret.metadata.name = secretName;

            try {
                await coreApi.createNamespacedSecret({
                    name: secretName,
                    namespace: targetNamespace,
                    body: secret
                });
                console.log(`Secret '${secretName}' copied to namespace '${targetNamespace}'`);
            } catch (createErr) {
                if (createErr.response?.statusCode === 409) {
                    await coreApi.replaceNamespacedSecret(secretName, targetNamespace, secret);
                    console.log(`Secret '${secretName}' replaced in namespace '${targetNamespace}'`);
                } else {
                    throw createErr;
                }
            }
        } catch (err) {
            console.error(`Failed to copy secret '${secretName}':`, err.message);
        }
    }
}

function loadYamlTemplates(userId, options) {
    const dir = path.join(__dirname, "templates");
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));

    // Exclude cleanup-job.yaml from start-session resources
    const cleanupIndex = files.indexOf("cleanup-job.yaml");
    if (cleanupIndex > -1) {
        files.splice(cleanupIndex, 1);
    }

    if (options.enable_recording == "false") {
        const rtmpIndex = files.indexOf("rtmp-pod.yaml");
        if (rtmpIndex > -1) {
            files.splice(rtmpIndex, 1)
        }
    }

    const allResources = [];

    for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), "utf-8");
        const replaced = content
            .replace(/\{\{UID\}\}/g, userId.toLowerCase())
            .replace(/\{\{VNC_PASSWD\}\}/g, options.vnc_passwd)
            .replace(/\{\{ENABLE_RECORDING\}\}/g, options.enable_recording)
            .replace(/\{\{USER_UID\}\}/g, userId)
            .replace(/\{\{SESSION_ID\}\}/g, options.session_id)
            .replace(/\{\{NAMESPACE_UID\}\}/g, options.namespace_uid)
        const loaded = yaml.loadAll(replaced);

        for (const obj of loaded) {
            if (!obj || !obj.kind) {
                console.error("Invalid Kubernetes object in", file, obj);
                continue;
            }
            allResources.push(obj);
        }
    }

    return allResources;
}

app.post("/start-session", authMiddleware, async (req, res) => {
    const uid = req.user.uid;
    const ns = `user-${uid.toLowerCase()}`
    const sessionExists = await redis.hGet(`user:${uid}`, "namespace");
    const enable_recording = req.body.enable_recording;

    if (sessionExists) {
        const session_id = await redis.hGet(`user:${uid}`, "session_id")

        return res.send({
            message: "Session exists",
            namespace: ns,
            vnc_passwd: await redis.hGet(`user:${uid}`, "vnc_passwd"),
            session_id: session_id
        })
    }

    const session_id = uuidv4()

    const namespaceManifest = {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
            name: ns,
        },
    };

    try {
        const nsObj = await k8sApi.create(namespaceManifest);
        console.log(`Namespace '${ns}' created successfully.`);

        let namespaceUid = nsObj.body?.metadata?.uid || nsObj.metadata?.uid;

        if (!namespaceUid) {
            console.log("UID not found in create response, fetching namespace...");
            const coreApi = kc.makeApiClient(CoreV1Api);
            const readNs = await coreApi.readNamespace(ns);
            namespaceUid = readNs.body.metadata.uid;
        }

        await copySecretsToNamespace(kc, ns);
        const vnc_passwd = randomBytes(4).toString("hex")
        const resources = loadYamlTemplates(uid, {
            vnc_passwd: vnc_passwd,
            enable_recording: enable_recording ? "true" : "false",
            session_id: session_id,
            namespace_uid: namespaceUid
        });

        for (const r of resources) {
            await k8sApi.create(r);
        }

        await redis.hSet(`user:${uid}`, "namespace", ns)
        await redis.hSet(`user:${uid}`, "vnc_passwd", vnc_passwd)
        await redis.hSet(`user:${uid}`, "session_id", session_id)
        await redis.hSet(`user:${uid}`, "enable_recording", enable_recording ? "true" : "false")

        res.status(201).send({
            message: "Session started",
            namespace: ns,
            vnc_passwd: vnc_passwd,
            session_id: session_id
        })
    } catch (err) {
        console.error(err);
        res.status(500).send(({
            error: "Failed to start session"
        }))
    }
})

app.post("/end-session", authMiddleware, async (req, res) => {
    const uid = req.user.uid;
    const ns = `user-${uid.toLowerCase()}`;

    const sessionExists = await redis.hGet(`user:${uid}`, "namespace");

    if (!sessionExists) {
        return res.status(404).send({ error: "No session found" });
    }

    try {
        const session_id = await redis.hGet(`user:${uid}`, "session_id")
        const summary = await getSessionSummary(uid, session_id, ns)
        await redis.hSet(`user:${uid}`, "summary", summary)
    } catch (err) {
        console.error(`[user-${uid}] Error generating agent session summary: ${err.message}`)
    }

    const enable_recording = await redis.hGet(`user:${uid}`, "enable_recording");
    const waitTimeout = enable_recording == "true" ? 900 : 60;

    try {
        console.log(`Starting cleanup job for user ${uid}...`);

        // Deleting the session-pod in order to terminate to recording 
        if (enable_recording === "true") {
            const core = kc.makeApiClient(CoreV1Api)
            await core.deleteNamespacedPod({
                name: `session-pod-${uid.toLowerCase()}`,
                namespace: ns
            })
        }

        const cleanupJobPath = path.join(__dirname, "templates", "cleanup-job.yaml");
        const cleanupJobContent = fs.readFileSync(cleanupJobPath, "utf-8");
        const cleanupJobReplaced = cleanupJobContent.replace(/\{\{UID\}\}/g, uid.toLowerCase())
            .replace(/\{\{WAIT_TIMEOUT\}\}/g, waitTimeout)
        const cleanupJob = yaml.load(cleanupJobReplaced);

        await k8sApi.create(cleanupJob);
        console.log(`Cleanup job started for user ${uid}`);
    } catch (jobErr) {
        console.error(`Failed to start cleanup job for user ${uid}:`, jobErr);
    }

    await redis.hDel(`user:${uid}`, "namespace")

    res.status(200).send({
        message: "Session termination initiated."
    });
});

app.delete("/namespace", authMiddleware, async (req, res) => {
    const uid = req.user.uid
    const ns = `user-${uid.toLowerCase()}`

    try {
        const core = kc.makeApiClient(CoreV1Api)
        await core.deleteNamespace({
            name: ns
        })
        await redis.del(`user:${uid}`)
        res.status(200).send({
            message: "User namespace deleted."
        })
    } catch (err) {
        if (err.statusCode === 404) {
            console.warn(`Namespace not found during deletion for user ${uid}, it may have already been removed.`);
            await redis.del(`user:${uid}`)
            res.status(200).send({
                message: "User namespace already removed."
            })
        } else {
            console.error(`Failed to delete namespace for user ${uid}:`, err);
            res.status(500).send({
                error: "Failed to initiate namespace deletion."
            });
        }
    }
})

app.use('/vnc', async (req, res, next) => {
    const uid = req.query.uid;
    const ns = await redis.hGet(`user:${uid}`, "namespace");

    if (!ns) {
        return res.status(404).json({ error: "No active session found" });
    }

    const serviceUrl = `http://browser-service.${ns}.svc.cluster.local:7900`;

    createProxyMiddleware({
        target: serviceUrl,
        changeOrigin: true,
        ws: true,
        pathRewrite: {
            '^/vnc': '',
        },
        onError(err, req, res) {
            console.error("VNC Proxy error:", err.message);
            if (!res.headersSent) {
                res.status(502).send("VNC Service Unavailable");
            }
        }
    })(req, res, next);
});

app.use('/agent', authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const ns = await redis.hGet(`user:${uid}`, 'namespace');
        if (!ns) return res.status(404).json({ error: 'No active session found' });

        const serviceUrl = `http://agent-service.${ns}.svc.cluster.local:8000`;
        const targetUrl = `${serviceUrl}${req.url}`;

        console.log(`Proxying ${req.method} ${req.url} to ${targetUrl}`);

        const fetchOptions = {
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
            },
        };

        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
            fetchOptions.body = JSON.stringify(req.body);
        }

        const proxyRes = await fetch(targetUrl, fetchOptions);

        // Forward status
        res.status(proxyRes.status);

        // Forward headers
        for (const [key, value] of proxyRes.headers) {
            if (key === 'content-encoding' || key === 'content-length') continue;
            res.setHeader(key, value);
        }

        if (proxyRes.body) {
            Readable.fromWeb(proxyRes.body).pipe(res);
        } else {
            res.end();
        }

    } catch (err) {
        console.error('Proxy error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Proxy request failed' });
    }
});

async function getSessionSummary(userId, sessionId, ns) {
    const agentServiceUrl = `http://agent-service.${ns}.svc.cluster.local:8000`

    const agentPayload = {
        prompt: "Based on our entire conversation, please provide a concise summary of the session's activities and findings. Only respond with the summary and nothing more.",
        user_id: userId,
        session_id: sessionId
    }

    console.log(`[user-${userId}] Requesting summary for session ${sessionId}...`)

    const summaryResponse = await fetch(`${agentServiceUrl}/summary`, {
        method: "POST",
        headers: {
            'Content-Type': "application/json"
        },
        body: JSON.stringify(agentPayload)
    })

    if (!summaryResponse.ok) {
        const err = await summaryResponse.text()
        throw new Error(`Agent returned an error during summarization: ${summaryResponse.status} - ${err}`)
    }

    const responseData = await summaryResponse.json()

    if (!responseData.summary) {
        throw new Error("Could not find a valid summary in the agent's response.")
    }

    return responseData.summary;
}

app.get("/", (req, res) => {
    res.send({
        message: "The Spectra Router is running!"
    })
})

const PORT = process.env.PORT || 80;

app.listen(PORT, () => {
    console.log(`Router running on port: ${PORT}`)
})