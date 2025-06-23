import { createClient } from "redis"
import "dotenv/config"

// Redis client
const client = createClient({
    password: process.env.REDIS_PASSWORD,
    username: process.env.REDIS_USERNAME,
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    }
});

client.connect()
    .then(() => console.log("Connected to Redis successfully."))
    .catch(err => console.error("Redis connection error:", err))

export {
    client
}