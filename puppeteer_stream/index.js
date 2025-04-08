import express from "express"
import "dotenv/config"
import { BrowserSession } from "./browser.js";

const app = express()
const PORT = process.env.PORT || 3000;

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use(express.static("public"))

app.listen(PORT, () => {
    console.log(`Listening on port: ${PORT}`)
})

app.get("/live", async (req, res) => {
    try {
        const browser = new BrowserSession()
        const stream = await browser.visitPage("https://google.com")
        
        res.setHeader('Content-Type', 'video/mp4'); 
        res.setHeader('Transfer-Encoding', 'chunked');
        res.setHeader('Connection', 'keep-alive');
        stream.pipe(res);
    } catch(err) {
        console.error("Error:", err.message)
        res.status(500).send({
            success: false,
            error: err.message
        })
    }
})