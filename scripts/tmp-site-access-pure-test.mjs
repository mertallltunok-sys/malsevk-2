// node scripts/tmp-site-access-pure-test.mjs
//
// app/_lib/site-access.ts'in saf mantığını (token türetme/doğrulama,
// zamanlama-güvenli karşılaştırma, güvenli-next-yolu kontrolü, ve en
// kritik olarak "ortam değişkeni tanımsızsa fail-closed" davranışı)
// sunucu gerektirmeden doğrular. Node'un yerleşik TypeScript desteğiyle
// .ts modülü doğrudan import edilir (bkz. scripts/locations/test-filter.mjs
// ile aynı desen).

import assert from "node:assert/strict";
import {
  computeSiteAccessToken,
  isSafeNextPath,
  isSiteAccessGateActive,
  isValidSiteAccessToken,
  timingSafeStringsEqual,
} from "../app/_lib/site-access.ts";

let passed = 0;
function ok(description) {
  passed++;
  console.log(`  ✓ ${description}`);
}

function withEnv(overrides, fn) {
  const original = {};
  for (const key of Object.keys(overrides)) {
    original[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

console.log("[tmp-site-access-pure-test] app/_lib/site-access.ts saf mantık testleri");

withEnv({ MALSEVK_SITE_PASSWORD: "GercekSifre123!" }, () => {
  const token = computeSiteAccessToken("GercekSifre123!");
  assert.equal(isValidSiteAccessToken(token), true);
  ok("Doğru şifreden türetilen token geçerli sayılıyor");

  assert.notEqual(token, "GercekSifre123!");
  assert.equal(token.includes("GercekSifre123"), false);
  ok("Token, düz şifreyi içermiyor/eşit değil (cookie'de düz şifre saklanmıyor)");

  const wrongToken = computeSiteAccessToken("YanlisSifre");
  assert.equal(isValidSiteAccessToken(wrongToken), false);
  ok("Farklı bir şifreden türetilen token geçersiz sayılıyor");

  assert.equal(isValidSiteAccessToken(undefined), false);
  assert.equal(isValidSiteAccessToken(""), false);
  assert.equal(isValidSiteAccessToken("not-a-valid-hex-token"), false);
  ok("Eksik/bozuk token değerleri güvenle reddediliyor (fırlatmıyor)");
});

withEnv({ MALSEVK_SITE_PASSWORD: undefined }, () => {
  assert.equal(process.env.MALSEVK_SITE_PASSWORD, undefined);
  const someToken = computeSiteAccessToken("herhangi-bir-sey");
  assert.equal(isValidSiteAccessToken(someToken), false);
  assert.equal(isValidSiteAccessToken("previously-issued-token"), false);
  ok("MALSEVK_SITE_PASSWORD tanımsızken HİÇBİR token geçerli sayılmıyor (fail-closed)");
});

withEnv({ MALSEVK_SITE_PASSWORD: "" }, () => {
  const someToken = computeSiteAccessToken("herhangi-bir-sey");
  assert.equal(isValidSiteAccessToken(someToken), false);
  ok("MALSEVK_SITE_PASSWORD boş string iken de fail-closed (geçerli token yok)");
});

assert.equal(timingSafeStringsEqual("abc", "abc"), true);
assert.equal(timingSafeStringsEqual("abc", "abd"), false);
assert.equal(timingSafeStringsEqual("short", "a-much-longer-string-value"), false);
assert.equal(timingSafeStringsEqual("", ""), true);
ok("timingSafeStringsEqual farklı uzunluklarda dahi doğru sonuç veriyor, fırlatmıyor");

assert.equal(isSafeNextPath("/panel"), true);
assert.equal(isSafeNextPath("/ilanlar/ilan-001"), true);
assert.equal(isSafeNextPath("//evil.com"), false);
assert.equal(isSafeNextPath("https://evil.com"), false);
assert.equal(isSafeNextPath("evil.com"), false);
ok("isSafeNextPath açık yönlendirme (open redirect) girişimlerini reddediyor");

withEnv({ NODE_ENV: "production" }, () => {
  assert.equal(isSiteAccessGateActive(), true);
});
withEnv({ NODE_ENV: "development" }, () => {
  assert.equal(isSiteAccessGateActive(), false);
});
ok("isSiteAccessGateActive yalnızca NODE_ENV=production'da true dönüyor");

console.log(`\n[tmp-site-access-pure-test] ${passed}/${passed} test geçti.`);
