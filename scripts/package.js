import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
// ZIP STORE entries: no runtime dependency or installer is bundled.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const entries = [], central = [];
let offset = 0;
const files = readdirSync(path.join(projectRoot, 'extension')).sort();
for (const filename of files) {
  const name = Buffer.from(filename);
  const data = readFileSync(path.join(projectRoot, 'extension', filename));
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  entries.push(local, name, data);
  const record = Buffer.alloc(46);
  record.writeUInt32LE(0x02014b50);
  record.writeUInt16LE(20, 4);
  record.writeUInt16LE(20, 6);
  record.writeUInt16LE(0x800, 8);
  record.writeUInt16LE(0x21, 14);
  record.writeUInt32LE(crc, 16);
  record.writeUInt32LE(data.length, 20);
  record.writeUInt32LE(data.length, 24);
  record.writeUInt16LE(name.length, 28);
  record.writeUInt32LE(offset, 42);
  central.push(record, name);
  offset += local.length + name.length + data.length;
}
const index = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(index.length, 12);
end.writeUInt32LE(offset, 16);
mkdirSync(path.join(projectRoot, 'outputs'), { recursive: true });
writeFileSync(path.join(projectRoot, 'outputs/condition-pick-display-prototype.zip'), Buffer.concat([...entries, index, end]));
console.log('Created outputs/condition-pick-display-prototype.zip (' + files.length + ' files)');
