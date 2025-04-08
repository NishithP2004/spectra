// import puppeteer from "puppeteer"
// import { PuppeteerScreenRecorder } from "puppeteer-screen-recorder"
// import { PassThrough } from "node:stream"
import { launch,  getStream } from "puppeteer-stream"
import { v4 as uuidv4 } from "uuid"

class BrowserSession {
    constructor() {
        this.sessionId = uuidv4()
        this.browser = null
        this.page = null
        this.url = null
    }

    async kill() {
        this.browser.close()
        this.stream.end()
    }

    async visitPage(url) {
        /* const browser = await puppeteer.launch({
            headless: false,
            defaultViewport: {
                width: 1920,
                height: 1080
            }
        }) */
       const browser = await launch({
            headless: false,
            executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
            defaultViewport: {
                width: 1280,
                height: 720
            }
       })

       this.browser = browser;
       this.url = url;
    
        try {
            const page = await browser.newPage()
            // const recorder = new PuppeteerScreenRecorder(page)
            this.page = page;
            await page.goto(url)
    
            /* const stream = new PassThrough();
            await recorder.startStream(stream); */
            const stream = await getStream(page, {
                audio: true,
                video: true,
                mimeType: 'video/webm;codecs=vp8',
                frameSize: 1
            })
    
            return stream
            /* await sleep(200)
            await recorder.stop() */
        } catch(err) {
            console.error(err.message)
        } finally {
            // await browser.close()
        }
    }
}

async function sleep(delay) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve()
        }, 1000 * delay);
    })
}

export {
    BrowserSession
}