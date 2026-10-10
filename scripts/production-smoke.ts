import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createAuth } from "../src/modules/auth/factory";
import { testDatabase } from "./test-database";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.TEST_DATABASE_URL || process.env.AUTH_TEST_DATABASE !== "disposable") {
  console.error("BLOCKED: production smoke requires an explicit disposable test DB."); process.exitCode=2;
} else {
  const { DATABASE_URL }=testDatabase(process.env);
  const db=new PrismaClient({adapter:new PrismaPg({connectionString:DATABASE_URL,max:3})});
  const origin="https://smoke.example.invalid",secret=randomBytes(48).toString("base64url"),email=`prod-smoke-${randomUUID()}@example.invalid`,password=randomBytes(24).toString("base64url");
  const network=randomBytes(4).toString("hex"), clientIp=`2001:db8:${network.slice(0,4)}:${network.slice(4)}::1`, ratePrefix=`2001:0db8:${network.slice(0,4)}:${network.slice(4)}:0000:0000:0000:0000|`;
  const auth=createAuth(db,{origin,secret,production:true},{async send(){}}); // Fixture setup only, child has real runtime.
  let userId:string|undefined,stage="fixture setup";
  const probe=createServer();probe.listen(0,"127.0.0.1");await once(probe,"listening");const address=probe.address();assert(address&&typeof address!=="string");const port=address.port; await new Promise<void>(resolve=>probe.close(()=>resolve()));
  const child=fork("node_modules/next/dist/bin/next",["start","--hostname","127.0.0.1","--port",String(address.port)],{execArgv:[],silent:true,windowsHide:true,
    env:{...process.env,NODE_ENV:"production",DATABASE_URL,APP_URL:origin,BETTER_AUTH_URL:origin,BETTER_AUTH_SECRET:secret,EMAIL_PROVIDER:"",RESEND_API_KEY:"",EMAIL_FROM:"",AUTH_HTTP_TEST:"",NODE_OPTIONS:"",NEXT_TELEMETRY_DISABLED:"1"}});
  child.stdout?.resume();child.stderr?.resume();
  async function request(path:string,body?:object,cookie="") {return fetch(`http://127.0.0.1:${port}${path}`,{method:body?"POST":"GET",redirect:"manual",headers:{origin,cookie,"content-type":"application/json","x-forwarded-for":clientIp},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});}
  try {
    const fixture=await auth.api.signUpEmail({body:{email,password,name:"Production smoke"}}); userId=fixture.user.id;
    await db.user.update({where:{id:userId},data:{emailVerified:true}});
    stage="next start readiness";
    for(let i=0;i<60;i++) {if(child.exitCode!==null)throw new Error("Child exited");const r=await request("/").catch(()=>null);if(r?.ok)break;if(i===59)throw new Error("Readiness timeout");await new Promise(resolve=>setTimeout(resolve,250));}
    stage="production login and cookie";
    const login=await request("/api/auth/sign-in/email",{email,password}); assert.equal(login.status,200);
    const cookies=login.headers.getSetCookie();assert(cookies.some(c=>/;\s*secure/i.test(c)&&/httponly/i.test(c)&&/samesite=lax/i.test(c))); assert(cookies.every(c=>!c.toLowerCase().includes("domain=")));
    const cookie=cookies.map(c=>c.split(";")[0]).join("; ");
    stage="production private/public HTTP and CSP";
    const account=await request("/account",undefined,cookie);assert.equal(account.status,200);assert.match(await account.text(),/Production smoke/);assert.match(account.headers.get("cache-control")!,/no-store/);assert.equal(account.headers.get("referrer-policy"),"no-referrer");
    for(const path of ["/","/sign-in","/jobs","/api/marketplace/jobs"]) {const r=await request(path);assert.equal(r.status,200);const csp=r.headers.get("content-security-policy")!;assert(csp.includes("frame-ancestors 'none'")&&!csp.includes("unsafe-eval"));assert.equal(r.headers.get("x-content-type-options"),"nosniff");assert.equal(r.headers.get("strict-transport-security"),null);}
    const denied=await request("/api/admin/cases",undefined,cookie);assert.equal(denied.status,403);assert.equal((await denied.json()).code,"FORBIDDEN");
    assert.equal((await request("/api/auth/sign-up/email",{email:`other-${email}`,password,name:"Unavailable mail"})).status,503);
    assert.equal((await request("/api/auth/sign-out",{},cookie)).status,200);assert.equal((await request("/account",undefined,cookie)).status,307);
    console.info("PASS: actual next start production build, real DB/session/cookie/login/account/logout, JSON errors, private cache, CSP without eval, missing email fails safely; no preload/deployment.");
  } catch {console.error(`FAIL: production smoke at ${stage}; sensitive diagnostics suppressed.`);process.exitCode=1;}
  finally {
    child.kill();await Promise.race([once(child,"exit").catch(()=>{}),new Promise(resolve=>setTimeout(resolve,5000))]);
    try {if(userId){await db.verification.deleteMany({where:{value:userId}});await db.session.deleteMany({where:{userId}});await db.account.deleteMany({where:{userId}});await db.user.delete({where:{id:userId}});}await db.rateLimit.deleteMany({where:{key:{startsWith:ratePrefix}}});}catch{console.error("FAIL: production smoke cleanup.");process.exitCode=1;}
    await db.$disconnect().catch(()=>{process.exitCode=1;});
  }
}
