/* Run with: node --test tests/field-utils.test.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {window: {}, Date, Intl};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'gis-field-utils.js'), 'utf8'), context);
const fields = context.window.GISFields;
const date = {name: 'DATE_MODIFIED', type: 'esriFieldTypeDate'};
const only = {name: 'INSPECTION_DATE', type: 'esriFieldTypeDateOnly'};

test('ArcGIS epoch milliseconds are readable UTC dates without a day shift', () => {
  assert.match(fields.format(date, 1658188800000), /Jul 19, 2022/);
  assert.match(fields.format(date, 1658188800000), /UTC$/);
  assert.match(fields.format(date, '2022-07-19T00:00:00Z'), /Jul 19, 2022/);
});
test('DateOnly and TimeOnly types are not exposed as milliseconds', () => {
  assert.equal(fields.format(only, 1658188800000), '2022-07-19');
  assert.equal(fields.format(only, '2022-07-19'), '2022-07-19');
  assert.equal(fields.format({type: 'esriFieldTypeTimeOnly'}, 3600000), '01:00:00');
});
test('Numeric IDs, null values and unsupported values remain safe', () => {
  assert.equal(fields.format({type: 'esriFieldTypeBigInteger'}, 1658188800000), '1658188800000');
  assert.equal(fields.format(date, null), '—');
  assert.equal(fields.format(date, 'not-a-date'), 'not-a-date');
});
test('Metadata field lookup and date-name fallback use field context', () => {
  assert.match(fields.formatNamed('date_modified', 1658188800000, [date]), /Jul 19, 2022/);
  assert.match(fields.formatNamed('DATE_MODIFIED', 1658188800000, []), /Jul 19, 2022/);
  assert.equal(fields.formatNamed('OBJECTID', 1658188800000, []), '1658188800000');
});
test('Date filters preserve the original UTC value for ArcGIS SQL', () => {
  assert.equal(fields.dateLiteral(date, 1658188800000), "DATE '2022-07-19 00:00:00'");
  assert.equal(fields.dateLiteral(date, '2022-07-19'), "DATE '2022-07-19'");
  assert.equal(fields.filterValue(date, 1658188800000), '2022-07-19 00:00:00');
  assert.throws(() => fields.dateLiteral(date, 'nonsense'), /Enter a date/);
});
test('Local display choice does not change the underlying timestamp', () => {
  fields.setZone('local');
  assert.match(fields.format(date, 1658188800000), /\(local\)$/);
  assert.equal(fields.filterValue(date, 1658188800000), '2022-07-19 00:00:00');
  fields.setZone('UTC');
});
