/**
 * Rewrites `domain/fixtures/golden.json` from the current engine.
 *
 *     bun run test:golden:update
 *
 * **Read the diff before committing it.** These files exist to make an
 * unintended change to the money visible; regenerating without looking at what
 * moved converts that safety net into a rubber stamp. A golden diff is either
 * accompanied by a deliberate behaviour change you can name, or it is a bug.
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GOLDEN_SCENARIOS, snapshot } from '../../domain/fixtures/scenarios'

const target = fileURLToPath(new URL('../../domain/fixtures/golden.json', import.meta.url))
const records = GOLDEN_SCENARIOS.map(snapshot)

writeFileSync(target, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
process.stdout.write(`Wrote ${records.length} golden records to ${target}\n`)
