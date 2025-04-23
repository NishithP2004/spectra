import { Client } from "@modelcontextprotocol/sdk/client/index.js"
// import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import "dotenv/config"
import express from "express"

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

/* const transportOptions = {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
    "env": {
        "PUPPETEER_LAUNCH_OPTIONS": JSON.stringify({
            headless: "new",
            executablePath: "/usr/bin/chromium"
        }),
        "ALLOW_DANGEROUS": "true"
    } 
} */

// const transport = new StdioClientTransport(transportOptions)
const serverSseUrl = new URL("http://localhost:3000/sse");
const transport = new SSEClientTransport(serverSseUrl);

const client = new Client({
    name: "spectra-client",
    version: "1.0.0"
})

console.log("Attempting to connect to Puppeteer MCP server...")
await client.connect(transport)
console.log("Successfully connected to Puppeteer MCP server.")

const PORT = process.env.CLIENT_PORT || 3001
app.listen(PORT, () => {
    console.log(`Listening on port: ${PORT}`)
})

app.get("/", (req, res) => {
    res.send({
        success: true,
        message: "Welcome to Spectra Agent!"
    })
})

app.get("/tools", async (req, res) => {
    try {
        const tools = await client.listTools()
        res.send({
            success: true,
            tools: tools.tools.map(t => ({ name: t.name, description: t.description }))
        })
    } catch (err) {
        console.error("Error connecting to Puppeteer MCP:", err.message)
        res.send({
            success: false,
            error: "Error connecting to Puppeteer MCP"
        })
    }
})
