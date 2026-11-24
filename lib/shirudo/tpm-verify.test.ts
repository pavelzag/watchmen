import { createHash, generateKeyPairSync, sign as cryptoSign } from "crypto";
import { verifyShirudoKeepaliveQuote, verifyShirudoTpmQuote } from "@/lib/shirudo/tpm-verify";

function buildTestTpmtPublic(x: Buffer, y: Buffer): Buffer {
  const parts: Buffer[] = [];
  const u16 = (n: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    return b;
  };
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  parts.push(u16(0x0023)); // TPM_ALG_ECC
  parts.push(u16(0x000b)); // TPM_ALG_SHA256
  parts.push(u32(0x00030072)); // objectAttributes
  parts.push(u16(0)); // empty authPolicy
  parts.push(u16(0x0010)); // symmetric = NULL
  parts.push(u16(0x0010)); // scheme = NULL
  parts.push(u16(0x0003)); // TPM_ECC_NIST_P256
  parts.push(u16(0x0010)); // kdf = NULL
  parts.push(u16(x.length), x);
  parts.push(u16(y.length), y);
  return Buffer.concat(parts);
}

function buildTestTpmsAttest(extraData: Buffer, opts?: { resetCount?: number; clock?: bigint; pcrMask?: number }): Buffer {
  const parts: Buffer[] = [];
  const u8 = (n: number) => Buffer.from([n]);
  const u16 = (n: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    return b;
  };
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const u64 = (n: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(n);
    return b;
  };
  parts.push(u32(0xff544347)); // TPM_GENERATED_VALUE
  parts.push(u16(0x8018)); // TPM_ST_ATTEST_QUOTE
  parts.push(u16(4), Buffer.from("signer")); // qualifiedSigner (actually len=6)
  parts.pop();
  const qs = Buffer.from("signer");
  parts.pop();
  parts.push(u16(qs.length), qs);
  parts.push(u16(extraData.length), extraData);
  parts.push(u64(opts?.clock ?? BigInt(123456)));
  parts.push(u32(opts?.resetCount ?? 7));
  parts.push(u32(0)); // restartCount
  parts.push(u8(1)); // safe
  parts.push(u64(BigInt(999))); // firmwareVersion
  parts.push(u32(1)); // pcrSelect count
  parts.push(u16(0x000b)); // SHA256
  parts.push(u8(3)); // sizeofSelect
  parts.push(Buffer.from([opts?.pcrMask ?? 0, 0, 0]));
  const pcrDigest = Buffer.alloc(32, 0xaa);
  parts.push(u16(pcrDigest.length), pcrDigest);
  return Buffer.concat(parts);
}

function buildTestTpmtSignature(r: Buffer, s: Buffer): Buffer {
  const u16 = (n: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    return b;
  };
  return Buffer.concat([u16(0x0018), u16(0x000b), u16(r.length), r, u16(s.length), s]);
}

describe("lib/shirudo/tpm-verify", () => {
  it("cryptographically verifies a genuine ECDSA P-256 TPM 2.0 keepalive quote", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const x = Buffer.from(jwk.x, "base64url");
    const y = Buffer.from(jwk.y, "base64url");

    const akBytes = buildTestTpmtPublic(x, y);
    const bodyString = JSON.stringify({ schema: "shirudo.keepalive/1", verdict: "ok", cond: 5461, flags: 0 });
    const bodyDigest = createHash("sha256").update(Buffer.from(bodyString, "utf8")).digest();
    const attestBytes = buildTestTpmsAttest(bodyDigest, { resetCount: 9, clock: BigInt(42000) });

    const ieeeSig = cryptoSign("sha256", attestBytes, { key: privateKey, dsaEncoding: "ieee-p1363" });
    const sigBytes = buildTestTpmtSignature(ieeeSig.subarray(0, 32), ieeeSig.subarray(32, 64));

    const quoteRaw = `attest=${attestBytes.toString("base64")};sig=${sigBytes.toString("base64")};ak=${akBytes.toString("base64")}`;

    const ok = verifyShirudoKeepaliveQuote(quoteRaw, bodyString);
    expect(ok.verified).toBe(true);
    expect(ok.resetCount).toBe(9);
    expect(ok.clock).toBe("42000");
    expect(ok.akName).toMatch(/^000b[0-9a-f]{64}$/);

    // Tampered body must fail qualifying data check
    const tampered = verifyShirudoKeepaliveQuote(quoteRaw, bodyString.replace('"ok"', '"tampered"'));
    expect(tampered.verified).toBe(false);
    expect(tampered.reason).toContain("extraData");

    // Corrupted signature must fail ECDSA check
    const badSigQuote = `attest=${attestBytes.toString("base64")};sig=${Buffer.concat([sigBytes.subarray(0, sigBytes.length - 1), Buffer.from([sigBytes[sigBytes.length - 1] ^ 0xff])]).toString("base64")};ak=${akBytes.toString("base64")}`;
    const badSig = verifyShirudoKeepaliveQuote(badSigQuote, bodyString);
    expect(badSig.verified).toBe(false);
    expect(badSig.reason).toContain("signature verification failed");
  });

  it("verifies challenge quotes that select PCRs against the issued nonce", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const akBytes = buildTestTpmtPublic(Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url"));
    const nonce = Buffer.from("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "hex");
    const attestBytes = buildTestTpmsAttest(nonce, { pcrMask: 0x02 });
    const ieeeSig = cryptoSign("sha256", attestBytes, { key: privateKey, dsaEncoding: "ieee-p1363" });
    const sigBytes = buildTestTpmtSignature(ieeeSig.subarray(0, 32), ieeeSig.subarray(32, 64));

    const quoteRaw = `attest=${attestBytes.toString("base64")};sig=${sigBytes.toString("base64")};ak=${akBytes.toString("base64")}`;
    const result = verifyShirudoTpmQuote({
      quoteRaw,
      expectedExtraData: nonce,
      requireEmptyPcrSelect: false,
    });
    expect(result.verified).toBe(true);
    expect(result.pcrSelectedBits).toBe(1);
  });
});
