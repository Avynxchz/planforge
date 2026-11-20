/* Agen bohongan berbentuk persis seperti `agy -p ... --output-format json`
   waktu TIDAK boleh memakai tool: status SUCCESS, tapi response kosong.
   Dipakai untuk menguji runner supaya tidak menganggap itu sebagai kerja selesai. */
const out = {
  conversation_id: "00000000-0000-0000-0000-000000000001",
  status: "SUCCESS",
  response: "",
  duration_seconds: 12.2,
  num_turns: 1,
  usage: { input_tokens: 9314, output_tokens: 447, thinking_tokens: 120 }
};
process.stdout.write(JSON.stringify(out) + "\n");
