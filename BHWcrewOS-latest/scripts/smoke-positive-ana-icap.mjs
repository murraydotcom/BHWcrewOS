// Offline synthetic rendering smoke: no authentication claim or production writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
const {chromium} = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright')) : require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer(async (req, res) => {
  const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const type = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css'}[extname(file)] || 'application/octet-stream';
    res.writeHead(200, {'Content-Type':type}).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  const origin=`http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => {
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    // These unrelated integrations are deliberately isolated; auth is unchanged.
    if(['/crew-provider-gate.js','/staff-chat-launcher.js','/bhw-alert-center.mjs'].includes(url.pathname))return route.fulfill({contentType:'text/javascript',body:''});
    if(url.pathname.startsWith('/.netlify/'))return route.fulfill({contentType:'application/json',body:'{"ok":true,"patients":[],"analyses":[]}'});
    return route.continue();
  });
  await page.goto(origin+'/bhw-positive-ana.html');
  await page.locator('.ana-pattern').selectOption('AC-1');
  await page.locator('.ana-titer').selectOption('160');
  await page.locator('#add-ana-pattern').click();
  await page.locator('.ana-pattern').nth(1).selectOption('AC-3');
  await page.locator('.ana-titer').nth(1).selectOption('640');
  await page.getByRole('button',{name:'Create clinical review →'}).click();
  let record=await page.evaluate(()=>window._analysisRecord);
  assert.deepEqual(record.anaPatterns.map(x=>[x.code,x.titer]),[['AC-1',160],['AC-3',640]]);
  assert.match(record.review.sourceSupportedContext.join(' '),/Systemic lupus erythematosus/);
  assert.match(record.review.sourceSupportedContext.join(' '),/Limited cutaneous systemic sclerosis/);
  assert.equal(await page.getByRole('link',{name:'ICAP AC-1 source',exact:true}).count(),1);
  await page.locator('.ana-pattern').first().selectOption('AC-2');
  await page.locator('.ana-pattern').nth(1).selectOption('AC-31');
  await page.getByRole('button',{name:'Create clinical review →'}).click();
  record=await page.evaluate(()=>window._analysisRecord);
  assert.match(record.review.sourceSupportedContext.join(' '),/Do not exclude disease from AC-2 alone/);
  assert.match(record.review.sourceSupportedContext.join(' '),/Ro60/);
  await page.locator('.ana-pattern').first().selectOption('other');
  await page.locator('.ana-titer').nth(1).selectOption('0');
  await page.getByRole('button',{name:'Create clinical review →'}).click();
  record=await page.evaluate(()=>window._analysisRecord);
  assert.equal(record.review.sourceReferences.filter(x=>x.title.startsWith('ICAP ')).length,0);
  assert.equal(record.review.sourceGaps.length,2);
  assert.deepEqual(errors,[]);
  console.log('PASS: mixed pattern/titer rendering, attributed associations, DFS70 and AC-31, unknown and conflicting results; no production calls.');
} finally {
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
