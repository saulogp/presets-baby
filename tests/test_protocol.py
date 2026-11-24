import unittest

from cubebaby import protocol as p


class TestVectors(unittest.TestCase):
    # Vectors published in github.com/pferreir/cuvave-midi (src/parser.rs)

    def test_pack_identify(self):
        clear = bytes([0x00, 0x59, 0x11, 0x00, 0x00, 0x00, 0xFF])
        self.assertEqual(p.pack7(clear), bytes([0x00, 0x32, 0x45, 0x00, 0x00, 0x00, 0x40, 0x7F, 0x00]))
        self.assertEqual(p.build_frame(p.CMD_IDENTIFY), clear)

    def test_init_message(self):
        self.assertEqual(p.to_sysex(p.build_frame(0x00)), bytes.fromhex("f0003201000000407f00f7"))

    def test_preset_b_delay_write(self):
        msg = bytes.fromhex("f000320949000040021b00000018000000013a01f7")
        f = p.parse_sysex(msg)
        self.assertEqual(f.cmd, p.CMD_WRITE)
        self.assertTrue(f.checksum_ok)
        self.assertEqual(f.data, bytes([0x05]) + (0x8000001B).to_bytes(4, "little") + b"\x01\x00\x00\x01")
        self.assertEqual(p.live_write(0x05, 0x8000001B, b"\x01"), msg)

    def test_roundtrip(self):
        for n in range(0, 300, 7):
            data = bytes((i * 37) & 0xFF for i in range(n))
            self.assertEqual(p.unpack7(p.pack7(data))[: len(data)], data)


class TestSafetyLock(unittest.TestCase):
    def test_flash_writes_refused(self):
        for space, addr in [(0x05, 0x0000), (0x00, 0x69000), (0x00, 0x80000000), (0x04, 0x80000000)]:
            with self.assertRaises(p.UnsafeOperation):
                p.live_write(space, addr, b"\x00")

    def test_out_of_range_live_refused(self):
        with self.assertRaises(p.UnsafeOperation):
            p.live_write(0x05, 0x80000030, b"\x00")
        with self.assertRaises(p.UnsafeOperation):
            p.live_write(0x05, 0x8000002F, b"\x00\x00")


if __name__ == "__main__":
    unittest.main()
