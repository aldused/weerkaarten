import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../waarschuwingen-archief.js', import.meta.url), 'utf8');
const {localDay, recordDays, matches, incompleteYellow} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
assert.equal(localDay('2026-11-20T23:30:00Z'), '2026-11-21');
// Local midnight is an exclusive end, including across the DST change.
assert.deepEqual(recordDays({onset:'2026-10-24T22:00:00Z',expires:'2026-10-25T23:00:00Z'}), ['2026-10-25']);
const record={onset:'2026-10-31T23:00:00Z',expires:'2026-11-02T00:00:00Z',codes:['geel'],phenomenon:'Gladheid',headline:'Bruggen en viaducten',description:'',areas:['Fryslân']};
assert.deepEqual(recordDays(record), ['2026-11-01', '2026-11-02']);
assert.ok(matches(record,2026,'11','geel','fryslan'));
assert.ok(!matches(record,2026,'10','geel',''));
assert.ok(!matches(record,2026,'11','rood',''));
const spanning={...record,onset:'2026-10-31T22:00:00Z'};
assert.ok(matches(spanning,2026,'10','alle'));
assert.ok(matches(spanning,2026,'11','alle'));
assert.ok(incompleteYellow({all_colors_since:'2026-11-02'},2026,'11'));
assert.ok(!incompleteYellow({all_colors_since:'2026-10-01'},2026,'11'));
console.log('Waarschuwingenarchief: lokale datums, maandgrenzen, filters en onvolledige dekking gecontroleerd');
