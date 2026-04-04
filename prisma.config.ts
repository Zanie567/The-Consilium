import { defineConfig } from '@prisma/config'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

export default defineConfig({
  datasource: {
    url: process.env.DIRECT_URL!,
  },
})
