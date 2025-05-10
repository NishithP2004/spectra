import { Storage } from "@google-cloud/storage"
import "dotenv/config"
import path from "node:path"
import fs from "node:fs"

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

        await bucket.upload(recordingPath)
        console.log(`[+] Recording (${recordingPath}) uploaded to gs://${bucketName}`)
    } catch(err) {
        console.error(`[!] Error uploading recording (${recordingPath}) to gs://${bucketName}: ${err.message}`)
    }
}

main()