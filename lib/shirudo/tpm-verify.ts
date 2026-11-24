import { createHash, createPublicKey, verify as cryptoVerify } from "crypto";

const TPM_GENERATED_VALUE = 0xff544347;
const TPM_ST_ATTEST_QUOTE = 0x8018;
const TPM_ALG_ECDSA = 0x0018;
const TPM_ALG_SHA256 = 0x000b;
const TPM_ALG_ECC = 0x0023;
const TPM_ALG_NULL = 0x0010;
const TPM_ECC_NIST_P256 = 0x0003;

export interface VerifiedTpmQuote {
  verified: boolean;
  akName: string | null;
  resetCount: number | null;
  clock: string | null;
  pcrSelectedBits: number;
  reason?: string;
}

class BinaryReader {
  private offset = 0;

  constructor(private readonly buf: Buffer) {}

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  readUInt8(): number {
    if (this.remaining < 1) throw new Error("Unexpected end of TPM buffer (uint8)");
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }

  readUInt16BE(): number {
    if (this.remaining < 2) throw new Error("Unexpected end of TPM buffer (uint16)");
    const v = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    return v;
  }

  readUInt32BE(): number {
    if (this.remaining < 4) throw new Error("Unexpected end of TPM buffer (uint32)");
    const v = this.buf.readUInt32BE(this.offset);
    this.offset += 4;
    return v;
  }

  readUInt64BE(): bigint {
    if (this.remaining < 8) throw new Error("Unexpected end of TPM buffer (uint64)");
    const v = this.buf.readBigUInt64BE(this.offset);
    this.offset += 8;
    return v;
  }

  readBytes(len: number): Buffer {
    if (len < 0 || this.remaining < len) {
      throw new Error(`Unexpected end of TPM buffer (${len} bytes)`);
    }
    const slice = this.buf.subarray(this.offset, this.offset + len);
    this.offset += len;
    return slice;
  }

  readTpm2b(): Buffer {
    const size = this.readUInt16BE();
    return this.readBytes(size);
  }
}

function pad32(buf: Buffer): Buffer {
  if (buf.length === 32) return buf;
  if (buf.length > 32) return buf.subarray(buf.length - 32);
  const out = Buffer.alloc(32);
  buf.copy(out, 32 - buf.length);
  return out;
}

export function parseQuoteAttributeSegments(quoteRaw: string): {
  attest: Buffer;
  sig: Buffer;
  ak: Buffer;
} {
  const parts = new Map<string, string>();
  for (const segment of quoteRaw.split(";")) {
    const eq = segment.indexOf("=");
    if (eq > 0) {
      parts.set(segment.slice(0, eq).trim(), segment.slice(eq + 1).trim());
    }
  }
  const attestB64 = parts.get("attest") ?? "";
  const sigB64 = parts.get("sig") ?? "";
  const akB64 = parts.get("ak") ?? "";
  if (!attestB64 || !sigB64 || !akB64) {
    throw new Error("Incomplete shirudo.quote attribute (expected attest, sig, and ak)");
  }
  const attest = Buffer.from(attestB64, "base64");
  const sig = Buffer.from(sigB64, "base64");
  const ak = Buffer.from(akB64, "base64");
  if (attest.length === 0 || sig.length === 0 || ak.length === 0) {
    throw new Error("Invalid base64 encoding in shirudo.quote");
  }
  return { attest, sig, ak };
}

function parseTpmtPublicEccP256(akBytes: Buffer): { x: Buffer; y: Buffer } {
  const r = new BinaryReader(akBytes);
  const type = r.readUInt16BE();
  if (type !== TPM_ALG_ECC) {
    throw new Error(`Unsupported TPM public key type 0x${type.toString(16)}`);
  }
  const nameAlg = r.readUInt16BE();
  if (nameAlg !== TPM_ALG_SHA256) {
    throw new Error(`Unsupported TPM nameAlg 0x${nameAlg.toString(16)}`);
  }
  r.readUInt32BE(); // objectAttributes
  r.readTpm2b(); // authPolicy

  const symAlg = r.readUInt16BE();
  if (symAlg !== TPM_ALG_NULL) {
    r.readUInt16BE(); // keyBits
    r.readUInt16BE(); // mode
  }

  const scheme = r.readUInt16BE();
  if (scheme !== TPM_ALG_NULL) {
    r.readUInt16BE(); // hashAlg
  }

  const curveId = r.readUInt16BE();
  if (curveId !== TPM_ECC_NIST_P256) {
    throw new Error(`Unsupported ECC curve 0x${curveId.toString(16)}`);
  }

  const kdf = r.readUInt16BE();
  if (kdf !== TPM_ALG_NULL) {
    r.readUInt16BE(); // kdf hashAlg
  }

  const x = pad32(r.readTpm2b());
  const y = pad32(r.readTpm2b());
  return { x, y };
}

function parseTpmtSignatureEcdsaSha256(sigBytes: Buffer): { r: Buffer; s: Buffer } {
  const reader = new BinaryReader(sigBytes);
  const sigAlg = reader.readUInt16BE();
  if (sigAlg !== TPM_ALG_ECDSA) {
    throw new Error(`Unsupported TPM signature algorithm 0x${sigAlg.toString(16)}`);
  }
  const hashAlg = reader.readUInt16BE();
  if (hashAlg !== TPM_ALG_SHA256) {
    throw new Error(`Unsupported TPM signature hash 0x${hashAlg.toString(16)}`);
  }
  const r = pad32(reader.readTpm2b());
  const s = pad32(reader.readTpm2b());
  return { r, s };
}

function parseTpmsAttestQuote(attestBytes: Buffer): {
  extraData: Buffer;
  clock: bigint;
  resetCount: number;
  pcrSelectedBits: number;
} {
  const reader = new BinaryReader(attestBytes);
  const magic = reader.readUInt32BE();
  if (magic !== TPM_GENERATED_VALUE) {
    throw new Error(`Invalid TPMS_ATTEST magic 0x${magic.toString(16)}`);
  }
  const type = reader.readUInt16BE();
  if (type !== TPM_ST_ATTEST_QUOTE) {
    throw new Error(`Unexpected TPMS_ATTEST type 0x${type.toString(16)}`);
  }
  reader.readTpm2b(); // qualifiedSigner
  const extraData = reader.readTpm2b();

  const clock = reader.readUInt64BE();
  const resetCount = reader.readUInt32BE();
  reader.readUInt32BE(); // restartCount
  reader.readUInt8(); // safe
  reader.readUInt64BE(); // firmwareVersion

  const pcrCount = reader.readUInt32BE();
  let pcrSelectedBits = 0;
  for (let i = 0; i < pcrCount; i++) {
    reader.readUInt16BE(); // hashAlg
    const sizeOfSelect = reader.readUInt8();
    const sel = reader.readBytes(sizeOfSelect);
    for (let b = 0; b < sel.length; b++) {
      let byte = sel[b];
      while (byte !== 0) {
        pcrSelectedBits += byte & 1;
        byte >>= 1;
      }
    }
  }
  reader.readTpm2b(); // pcrDigest

  return { extraData, clock, resetCount, pcrSelectedBits };
}

/**
 * Cryptographically verifies a Shirudo TPM 2.0 quote (`attest=...;sig=...;ak=...`)
 * against the expected qualifying data (SHA-256 of keepalive body, or raw challenge nonce).
 */
export function verifyShirudoTpmQuote(params: {
  quoteRaw: string | undefined;
  expectedExtraData: Buffer;
  requireEmptyPcrSelect?: boolean;
}): VerifiedTpmQuote {
  if (!params.quoteRaw) {
    return {
      verified: false,
      akName: null,
      resetCount: null,
      clock: null,
      pcrSelectedBits: 0,
      reason: "Missing shirudo.quote attribute",
    };
  }

  let akName: string | null = null;
  try {
    const { attest, sig, ak } = parseQuoteAttributeSegments(params.quoteRaw);
    akName = `000b${createHash("sha256").update(ak).digest("hex")}`;

    const parsedAttest = parseTpmsAttestQuote(attest);
    if (params.requireEmptyPcrSelect && parsedAttest.pcrSelectedBits > 0) {
      return {
        verified: false,
        akName,
        resetCount: parsedAttest.resetCount,
        clock: parsedAttest.clock.toString(),
        pcrSelectedBits: parsedAttest.pcrSelectedBits,
        reason: "Keepalive quote unexpectedly selects PCR bits",
      };
    }

    if (!parsedAttest.extraData.equals(params.expectedExtraData)) {
      return {
        verified: false,
        akName,
        resetCount: parsedAttest.resetCount,
        clock: parsedAttest.clock.toString(),
        pcrSelectedBits: parsedAttest.pcrSelectedBits,
        reason: "TPM quote qualifying data (extraData) does not match payload digest/nonce",
      };
    }

    const { x, y } = parseTpmtPublicEccP256(ak);
    const { r, s } = parseTpmtSignatureEcdsaSha256(sig);

    const publicKey = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: x.toString("base64url"),
        y: y.toString("base64url"),
      },
      format: "jwk",
    });

    const sigOk = cryptoVerify(
      "sha256",
      attest,
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.concat([r, s])
    );

    if (!sigOk) {
      return {
        verified: false,
        akName,
        resetCount: parsedAttest.resetCount,
        clock: parsedAttest.clock.toString(),
        pcrSelectedBits: parsedAttest.pcrSelectedBits,
        reason: "TPM ECDSA-SHA256 signature verification failed",
      };
    }

    return {
      verified: true,
      akName,
      resetCount: parsedAttest.resetCount,
      clock: parsedAttest.clock.toString(),
      pcrSelectedBits: parsedAttest.pcrSelectedBits,
    };
  } catch (err) {
    return {
      verified: false,
      akName,
      resetCount: null,
      clock: null,
      pcrSelectedBits: 0,
      reason: err instanceof Error ? err.message : "Quote verification error",
    };
  }
}

export function verifyShirudoKeepaliveQuote(quoteRaw: string | undefined, rawBodyString: string): VerifiedTpmQuote {
  const expectedDigest = createHash("sha256").update(Buffer.from(rawBodyString, "utf8")).digest();
  return verifyShirudoTpmQuote({
    quoteRaw,
    expectedExtraData: expectedDigest,
    requireEmptyPcrSelect: true,
  });
}
