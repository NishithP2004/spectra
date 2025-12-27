import admin from "firebase-admin"
import "dotenv/config"
import fs from "node:fs/promises"

// Firebase Admin setup
const serviceAccount = JSON.parse(await fs.readFile("./credentials.json", "utf-8"))
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
})

export {
    admin
}