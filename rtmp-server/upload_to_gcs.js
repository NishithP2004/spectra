import { Storage } from "@google-cloud/storage"
import "dotenv/config"
import path from "node:path"
import fs from "node:fs"
import { client as redis } from "./redis.js"

const storage = new Storage({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || "./credentials.json"
});

const bucketName = process.env.GCS_BUCKET_NAME || "spectra-recordings"
const bucket = storage.bucket(bucketName)

const recordingPath = path.resolve(process.argv[2]);

const main = async () => {
    try {
        if(!fs.existsSync(recordingPath)) {
            throw new Error("Recording file not found at the provided path")
        }
        
        const user_uid = process.env["USER_UID"]
        const session_id = process.env["SESSION_ID"]

        const summary = await redis.hGet(`user:${user_uid}`, "summary")

        await bucket.upload(recordingPath, {
            destination: `gs://${bucketName}/${user_uid}/${session_id}.flv`,
            metadata: {
                user_uid,
                session_id,
                summary
            },
            public: true
        })
        
        console.log(`[+] Recording (${recordingPath}) uploaded to gs://${bucketName}`)
    } catch(err) {
        console.error(`[!] Error uploading recording (${recordingPath}) to gs://${bucketName}: ${err.message}`)
    }
}

main()