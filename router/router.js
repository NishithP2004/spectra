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

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Kubernetes setup
const kc = new KubeConfig()
kc.loadFromDefault()
const k8sApi = KubernetesObjectApi.makeApiClient(kc)

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

async function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1]

    if(!token) {
        res.status(401).json({
            error: "Session token missing"
        })
    }

    try {
        const decoded = await admin.auth().verifyIdToken(token)
        req.user = decoded;
        next();
    } catch(err) {
        res.status(401).json({
            error: "Invalid token"
        })
    }
}

function loadYamlTemplates(userId) {
    const dir = path.join(__dirname, "templates");
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));

    const allResources = [];

    for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), "utf-8");
        const replaced = content.replace(/\{\{UID\}\}/g, userId.toLowerCase()); // Use global replacement
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
    const sessionExists = await redis.get(`user:${uid}:namespace`);

    if(sessionExists) return res.send({
        message: "Session exists"
    })

    try {
        const resources = loadYamlTemplates(uid);
        for(const r of resources) {
            await k8sApi.create(r);
        }
        await redis.set(`user:${uid}:namespace`, ns)
        res.status(201).send({
            message: "Session started",
            namespace: ns
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
    const ns = await redis.get(`user:${uid}:namespace`);

    if(!ns) return res.status(404).send({
        error: "No session found"
    })

    try {
        const core = kc.makeApiClient(CoreV1Api)
        await core.deleteNamespace(ns);
        await redis.del(`user:${uid}:namespace`)
        res.status(200).send({
            message: "Session deleted"
        })
    } catch(err) {
        console.error(err);
        res.status(500).send(({
            error: "Failed to delete session"
        }))
    }
})

app.get("/namespace", authMiddleware, async (req, res) => {
    const uid = req.user.uid;
    const ns = await redis.get(`user:${uid}:namespace`);
    if(!ns) return res.status(404).send({
        error: "No session found"
    })

    res.json({ namespace: ns })
})

app.use('/agent', authMiddleware, async (req, res, next) => {
    const uid = req.user.uid;
    const ns = await redis.get(`user:${uid}:namespace`);

    if (!ns) {
        return res.status(404).json({ error: "No active session found" });
    }

    const serviceUrl = `http://agent.${ns}.svc.cluster.local:8000`;

    return createProxyMiddleware({
        target: serviceUrl,
        changeOrigin: true,
        pathRewrite: {
            '^/agent': '', 
        },
        onError(err, req, res) {
            console.error("Proxy error:", err.message);
            res.status(502).send("Service Unavailable");
        }
    })(req, res, next);
});

const PORT = process.env.PORT || 80;

app.listen(PORT, () => {    
    console.log(`Router running on port: ${PORT}`)
})