# backup/

- `presets_bank5.bin`: the 3 presets (A/B/C, 16 bytes each) as read from space 0x05 addr 0
  on 2026-11-23, before any write. This is the RAM working copy, which matched what was stored at the time.
- `bank0_read_0x00000-0x80000_NOT_A_FLASH_DUMP.bin`: **not a flash backup.** On the regular
  Cube Baby (chip id 0x4F06), reads from space 0x00 return a RAM buffer (byte0 varies, then the
  48 preset bytes, then 0x7d and padding), repeated every 64-byte read block. The exception
  looks like the IR area around 0x69000. Kept only as a reference.
