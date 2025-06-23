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

    if(!token) {
        return res.status(401).json({
            error: "Session token missing"
        })
    }

    try {
        const decoded = await admin.auth().verifyIdToken(token)
        req.user = decoded;
        next();
    } catch(err) {
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

    if(options.enable_recording == "false") {
        files.splice(files.indexOf("rtmp-pod.yaml"), 1)
    }

    const allResources = [];

    for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), "utf-8");
        const replaced = content
                        .replace(/\{\{UID\}\}/g, userId.toLowerCase())
                        .replace(/\{\{VNC_PASSWD\}\}/g, options.vnc_passwd)
                        .replace(/\{\{ENABLE_RECORDING\}\}/g, options.enable_recording) 
                        .replace(/\{\{USER_UID\}\}/g, userId) 
                        .replace(/\{\{SESSION_ID\}\}/g, options.session_id) // Use global replacement
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

    if(sessionExists) {
        return res.send({
            message: "Session exists",
            namespace: ns,
            vnc_passwd: await redis.hGet(`user:${uid}`, "vnc_passwd")
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
        await k8sApi.create(namespaceManifest);
        console.log(`Namespace '${ns}' created successfully.`);

        await copySecretsToNamespace(kc, ns);
        const vnc_passwd = randomBytes(4).toString("hex")
        const resources = loadYamlTemplates(uid, {
            vnc_passwd: vnc_passwd,
            enable_recording: enable_recording? "true": "false",
            session_id: session_id
        });

        for(const r of resources) {
            await k8sApi.create(r);
        }

        await redis.hSet(`user:${uid}`, "namespace", ns)
        await redis.hSet(`user:${uid}`, "vnc_passwd", vnc_passwd)
        await redis.hSet(`user:${uid}`, "session_id", session_id)

        res.status(201).send({
            message: "Session started",
            namespace: ns,
            vnc_passwd: vnc_passwd,
            session_id: session_id
        })
    } catch(err) {
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

    if(!sessionExists) {
        return res.status(404).send({ error: "No session found" });
    }

    try {
        const podName = `session-pod-${uid.toLowerCase()}`;
        console.log(`Deleting interactive session pod: ${podName} in namespace ${ns}`);

        const coreApi = kc.makeApiClient(CoreV1Api);
        await coreApi.deleteNamespacedPod({
            name: podName,
            namespace: ns
        });

        try {
            const session_id = await redis.hGet(`user:${uid}`, "session_id")
            const summary = await getSessionSummary(uid, session_id, ns)
            await redis.hSet(`user:${uid}`, "summary", summary)
        } catch(err) {
            console.error(`[user-${uid}] Error generating agent session summary: ${err.message}`)
        }

        await redis.hDel(`user:${uid}`, "namespace")

        res.status(200).send({
            message: "Session termination initiated. Recording will be processed."
        });
    } catch(err) {
        if (err.statusCode === 404) {
            console.warn(`Pod not found during deletion for user ${uid}, it may have already been terminated.`);

            await redis.hDel(`user:${uid}`, "namespace")
            return res.status(200).send({ message: "Session already terminated." });
        }

        console.error(`Failed to delete session pod for user ${uid}:`, err);
        res.status(500).send({
            error: "Failed to initiate session termination."
        });
    }
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
    } catch(err) {
        if(err.statusCode === 404) {
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

app.use('/agent/run_sse', authMiddleware, (req, res, next) => {
    
    const agentProxy = createProxyMiddleware({
        target: 'http://agent-service.internal', 
        changeOrigin: true, 
        
        router: async (req) => {
            const uid = req.user.uid; 
            const ns = await redis.hGet(`user:${uid}`, 'namespace');
            
            if (!ns) {
                throw new Error(`No active session namespace for user ${uid}`);
            }
            
            return `http://agent-service.${ns}.svc.cluster.local:8000/run_sse`;
        },

        // pathRewrite: { '^/agent/run_sse': '/run_sse' },

        onProxyReq: (proxyReq, req, res) => {
            proxyReq.setHeader('Accept', 'text/event-stream');
            proxyReq.setHeader('Cache-Control', 'no-cache');
            proxyReq.setHeader('Connection', 'keep-alive');
        },
        
        onProxyRes: (proxyRes, req, res) => {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');     
        },

        onError: (err, req, res) => {
            const uid = req.user?.uid || 'unknown';
            console.error(`[user-${uid}] Agent /run_sse Proxy error:`, err.message);
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: "Agent Streaming Service Unavailable", 
                    details: err.message 
                }));
            }
        }
    });

    agentProxy(req, res, next);
});

app.use('/agent', authMiddleware, async (req, res, next) => {
  try {
    const uid = req.user.uid;
    const ns = await redis.hGet(`user:${uid}`, 'namespace');
    if (!ns) return res.status(404).json({ error: 'No active session found' });

    const serviceUrl = `http://agent-service.${ns}.svc.cluster.local:8000`;

    console.log("Proxying Agent request...")
    createProxyMiddleware({
      target: serviceUrl,
      changeOrigin: true,
      pathRewrite: { '^/agent': '' },
      onError(err, req, res) {
        console.error('Proxy error:', err.message);
        if (!res.headersSent) res.status(502).send('Service Unavailable');
      }
    })(req, res, next);
  } catch (err) {
    console.error('Redis error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  }
});

async function getSessionSummary(userId, sessionId, ns) {
    const agentServiceUrl = `http://agent-service.${ns}.svc.cluster.local:8000`

    const agentPayload = {
        appName: "spectra-agent",
        userId: userId,
        sessionId: sessionId,
        newMessage: {
            role: "user",
            parts: [{
                text: "Based on our entire conversation, please provide a concise summary of the session's activities and findings."
            }]
        }
    }

    console.log(`[user-${userId}] Requesting summary for session ${sessionId}...`)

    const summaryResponse = await fetch(`${agentServiceUrl}/run`, {
        method: "POST",
        headers: {
            'Content-Type': "application/json"
        },
        body: JSON.stringify(agentPayload)
    })

    if(!summaryResponse.ok) {
        const err = await summaryResponse.text()
        throw new Error(`Agent returned an error during summarization: ${summaryResponse.status} - ${err}`)
    }

    const events = await summaryResponse.json()
    const lastModelEvent = events.filter(e => e.content?.role === "model" && e.content?.parts[0]?.text).pop();

    if(!lastModelEvent || !lastModelEvent.content.parts[0].text) {
        throw new Error("Could not find a valid summary in the agent's response.")
    }

    return lastModelEvent.content.parts[0].text;
}

async function createAgentSession(userId, sessionId, ns) {
    const agentServiceUrl = `http://agent-service.${ns}.svc.cluster.local:8000`
    const targetUrl = `/apps/spectra-agent/users/${userId}/sessions/${sessionId}/`

    console.log(`[user-${userId}] Creating Agent session ${sessionId}...`)

    const response = await fetch(`${agentServiceUrl}/${targetUrl}`, {
        method: "POST"
    })

    if(!response.ok) {
        const err = await response.text()
        throw new Error(`[user-${userId}] Failed to create agent session: ${err}`)
    }
}

const PORT = process.env.PORT || 80;

app.listen(PORT, () => {    
    console.log(`Router running on port: ${PORT}`)
})