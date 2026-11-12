/** GPT-2 byte-level BPE, using only the revision-pinned vocabulary and merges. */
export class Gpt2Tokenizer {
  private readonly encoder = new Map<number, string>();
  private readonly decoder = new Map<string, number>();
  private readonly ranks = new Map<string, number>();
  private readonly vocabulary: Map<string, number>;
  private readonly words = new Map<number, string>();
  constructor(vocabulary: string, merges: string) {
    const bytes = [...Array.from({ length: 94 }, (_, i) => i + 33), ...Array.from({ length: 12 }, (_, i) => i + 161), ...Array.from({ length: 82 }, (_, i) => i + 174)];
    let extra = 256;
    for (let byte = 0; byte < 256; byte++) {
      const value = String.fromCodePoint(bytes.includes(byte) ? byte : extra++);
      this.encoder.set(byte, value); this.decoder.set(value, byte);
    }
    this.vocabulary = new Map(Object.entries(JSON.parse(vocabulary) as Record<string, number>));
    if (this.vocabulary.size !== 50257 || this.vocabulary.get("<|endoftext|>") !== 50256) throw new Error("browser_tokenizer_invalid");
    for (const [word, id] of this.vocabulary) this.words.set(id, word);
    const lines = merges.trimEnd().split(/\r?\n/).slice(1);
    lines.forEach((line, index) => this.ranks.set(line, index));
  }
  encode(text: string): number[] {
    const output: number[] = [];
    for (const match of text.matchAll(/'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu)) {
      let parts = Array.from(new TextEncoder().encode(match[0]), byte => this.encoder.get(byte)!);
      while (parts.length > 1) {
        let rank = Infinity, pair = "";
        for (let i = 0; i < parts.length - 1; i++) {
          const candidate = parts[i] + " " + parts[i + 1], value = this.ranks.get(candidate) ?? Infinity;
          if (value < rank) { rank = value; pair = candidate; }
        }
        if (rank === Infinity) break;
        const merged: string[] = [];
        for (let i = 0; i < parts.length; i++) {
          if (i + 1 < parts.length && parts[i] + " " + parts[i + 1] === pair) merged.push(parts[i]! + parts[++i]!);
          else merged.push(parts[i]!);
        }
        parts = merged;
      }
      for (const part of parts) {
        const id = this.vocabulary.get(part); if (id === undefined) throw new Error("browser_tokenizer_unknown");
        output.push(id);
      }
    }
    return output;
  }
  decode(ids: number[]): string {
    const bytes: number[] = [];
    for (const id of ids) {
      if (id === 50256) continue;
      const word = this.words.get(id); if (!word) throw new Error("browser_tokenizer_unknown");
      for (const char of word) { const byte = this.decoder.get(char); if (byte === undefined) throw new Error("browser_tokenizer_unknown"); bytes.push(byte); }
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
}
