import type { Plugin, Connect } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { IncomingMessage, ServerResponse } from 'node:http'

const execAsync = promisify(exec)

export function mapStudioPlugin(): Plugin {
  return {
    name: 'map-studio-plugin',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        if (req.method === 'POST' && req.url === '/api/studio/save') {
          let body = ''
          req.on('data', (chunk: Buffer | string) => {
            body += chunk.toString()
          })
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              const rootDir = process.cwd()
              const dataDir = path.join(rootDir, 'public', 'data')

              const writeJson = (filePath: string, obj: unknown) => {
                const tempPath = filePath + '.tmp'
                fs.writeFileSync(tempPath, JSON.stringify(obj, null, 2), 'utf-8')
                fs.renameSync(tempPath, filePath)
              }

              if (data.countries) {
                writeJson(path.join(dataDir, 'countries.geojson'), data.countries)
                writeJson(path.join(dataDir, 'countries-display.geojson'), data.countries)
              }
              if (data.countryBorders) {
                writeJson(path.join(dataDir, 'country-borders.geojson'), data.countryBorders)
                writeJson(path.join(dataDir, 'country-borders-display.geojson'), data.countryBorders)
              }
              if (data.regions) {
                writeJson(path.join(dataDir, 'regions.geojson'), data.regions)
              }
              if (data.regionBorders) {
                writeJson(path.join(dataDir, 'region-borders.geojson'), data.regionBorders)
              }
              if (data.countryLabels) {
                writeJson(path.join(dataDir, 'country-label-points.geojson'), data.countryLabels)
              }
              if (data.regionLabels) {
                writeJson(path.join(dataDir, 'region-label-points.geojson'), data.regionLabels)
              }
              if (data.countryNames) {
                const namesPath = path.join(rootDir, 'tools', 'extraction', 'country-names.json')
                writeJson(namesPath, data.countryNames)
              }

              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  success: true,
                  message: 'Все файлы карты успешно сохранены локально!',
                }),
              )
            } catch (error: unknown) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                }),
              )
            }
          })
          return
        }

        if (req.method === 'POST' && req.url === '/api/studio/publish') {
          let body = ''
          req.on('data', (chunk: Buffer | string) => {
            body += chunk.toString()
          })
          req.on('end', async () => {
            try {
              const { message, deployGhPages = true } = JSON.parse(body || '{}')
              const commitMsg = message?.trim() || 'Обновление карты через OpenStreetRP Studio'

              // Stage data and check if there are actual diffs
              await execAsync('git add public/data tools/extraction')
              const { stdout: diffOut } = await execAsync('git status --porcelain public/data tools/extraction')

              let commitOut = ''
              let pushOut = ''
              if (diffOut.trim().length > 0) {
                const commitRes = await execAsync(
                  `git commit -m "${commitMsg.replace(/"/g, '\\"')}"`,
                )
                commitOut = commitRes.stdout
                const pushRes = await execAsync('git push origin main')
                pushOut = pushRes.stdout
              } else {
                commitOut = 'Файлы карты уже актуальны, новых изменений для коммита не обнаружено.'
              }

              let ghPagesOut = ''
              if (deployGhPages) {
                await execAsync('pnpm build')
                const deployRes = await execAsync('pnpm gh-pages -d dist')
                ghPagesOut = deployRes.stdout
              }

              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  success: true,
                  message: 'Изменения успешно закоммичены и опубликованы на GitHub Pages!',
                  details: { commitOut, pushOut, ghPagesOut },
                }),
              )
            } catch (error: unknown) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                }),
              )
            }
          })
          return
        }

        next()
      })
    },
  }
}
