const URL = Deno.env.get("SUPABASE_URL")!;
const ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_RELAY_URL = Deno.env.get("GMAIL_RELAY_URL") || "";
const GMAIL_RELAY_SECRET = Deno.env.get("GMAIL_RELAY_SECRET") || "";

const REPLY = "abellaattoo@gmail.com";
const ADDRESS = Deno.env.get("BOOKING_ADDRESS") || "";
const ADMIN = "4f6ebcbe-ec6f-4d78-ad3c-14ba94c503bc";
const cors = {"Access-Control-Allow-Origin":"https://abellabbeauty.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"};
const esc = (s:unknown) => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const json = (data:unknown,status=200) => new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
async function db(path:string,init:RequestInit={}) {
 const r=await fetch(URL+"/rest/v1/"+path,{...init,headers:{apikey:ROLE,Authorization:"Bearer "+ROLE,"Content-Type":"application/json",...(init.headers||{})}});
 const data=await r.json().catch(()=>null);
 if(!r.ok) throw new Error(data?.message||"Booking service unavailable. Please try again.");
 return data;
}
function emailBody(b:any) {
 const date=new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date(b.start_at));
 const time=new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",hour:"numeric",minute:"2-digit",hour12:true}).format(new Date(b.start_at));
 const total=new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD"}).format(Number(b.total_price));
 const extras=(b.service_details?.addons||[]).map((a:any)=>a.name+(a.quantity?" × "+a.quantity:"")).join(", ")||"None";
 const policy="Please provide at least 24 hours’ notice to cancel or reschedule.";
 const text="abellabbeauty — Booking confirmed ♡\nHi "+b.client_name+", your appointment has been booked successfully.\nService: "+b.service_name+"\nCustomisations: "+extras+"\nDate: "+date+"\nTime: "+time+" (Sydney local time)\nAmount due at appointment: "+total+"\nAppointment location: "+ADDRESS+"\nBooking reference: "+b.id+"\n"+policy+"\nPlease contact abellabbeauty at "+REPLY+" if you need to make changes.";
 const rows=[["Service",b.service_name],["Customisations",extras],["Date",date],["Time",time+" (Sydney local time)"],["Amount due at appointment",total],["Booking reference",b.id]];
 const html='<!doctype html><html><body style="margin:0;background:#fbf6f3;font-family:Arial,sans-serif;color:#241d1d"><div style="max-width:620px;margin:auto;padding:32px 18px"><div style="background:white;border:1px solid #ead8d8;border-radius:20px;padding:28px"><div style="text-align:center;font:30px Georgia,serif">abellabbeauty</div><h1 style="font-size:24px;text-align:center">Booking confirmed ♡</h1><p>Hi '+esc(b.client_name)+', your appointment has been booked successfully.</p><table style="width:100%;border-collapse:collapse">'+rows.map(([k,v])=>'<tr><td style="padding:12px 4px;border-top:1px solid #f0e1e1">'+esc(k)+'</td><td style="padding:12px 4px;border-top:1px solid #f0e1e1;text-align:right;overflow-wrap:anywhere">'+esc(v)+'</td></tr>').join('')+'</table><div style="background:#fff6f7;border-radius:14px;padding:16px;margin-top:24px"><strong>Appointment location</strong><br>'+esc(ADDRESS)+'</div><div style="padding:16px 0;line-height:1.6"><strong>Booking policies</strong><br>'+esc(policy)+'</div><p>Please contact <a href="mailto:'+esc(REPLY)+'">'+esc(REPLY)+'</a> if you need to make changes to your appointment.</p></div></div></body></html>';
 return {html,text};
}
async function sendEmail(b:any) {
 if(b.confirmation_email_status==="sent") return "sent";
 const {html,text}=emailBody(b);
 const payload=JSON.stringify({timestamp:Date.now(),booking_id:b.id,to:b.client_email,subject:"Booking confirmed — "+b.service_name,html,text});
 try {
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(GMAIL_RELAY_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(payload)))).map(n=>n.toString(16).padStart(2,"0")).join("");
  const r=await fetch(GMAIL_RELAY_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({payload,signature}),signal:AbortSignal.timeout(45000)});
  const result=await r.json();
  if(r.ok&&result.ok===true&&result.status==="sent"&&result.booking_id===b.id){
   await db("bookings?id=eq."+b.id,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({confirmation_email_status:"sent",confirmation_email_sent_at:new Date().toISOString(),confirmation_email_id:"gmail/"+b.id})});
   return "sent";
  }
  console.error("Gmail confirmation not accepted",b.id,result.error||"unknown");
 }catch{console.error("Gmail confirmation request failed",b.id);}
 await db("bookings?id=eq."+b.id,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({confirmation_email_status:"failed"})}).catch(()=>{});
 return "failed";
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return json({error:"Method not allowed"},405);
 try {
  if(!GMAIL_RELAY_URL||!GMAIL_RELAY_SECRET||!ADDRESS) return json({error:"Online booking is temporarily unavailable. Please contact abellabbeauty."},503);
  if(Number(req.headers.get("content-length")||0)>20000) return json({error:"Request too large"},413);
  const raw=await req.text();if(raw.length>20000) return json({error:"Request too large"},413);
  const p=JSON.parse(raw);let b;
  if(p.action==="retry_email") {
   const auth=await fetch(URL+"/auth/v1/user",{headers:{apikey:ROLE,Authorization:req.headers.get("Authorization")||""}});
   const user=await auth.json();if(!auth.ok||user.id!==ADMIN) return json({error:"Unauthorised"},403);
   if(!/^[0-9a-f-]{36}$/i.test(p.booking_id||"")) return json({error:"Invalid reference"},400);
   b=(await db("bookings?id=eq."+p.booking_id+"&select=*"))[0];
   if(!b||b.booking_status!=="confirmed") return json({error:"Confirmed booking not found"},404);
  } else {
   if(p.agreed_to_policies!==true) return json({error:"Please agree to the booking policies."},400);
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.request_id||"")) return json({error:"Invalid booking request. Please refresh."},400);
   b=await db("rpc/create_direct_booking",{method:"POST",body:JSON.stringify({p_request_id:p.request_id,p_client_name:p.client_name,p_client_email:p.client_email,p_client_phone:p.client_phone,p_service_key:p.service_key,p_full_design:p.full_design,p_addons:p.addons,p_removal:p.removal,p_start_at:p.start_at,p_notes:p.notes||null})});
  }
  const email_status=await sendEmail(b);
  return json({booking_id:b.id,booking_status:b.booking_status,service_name:b.service_name,start_at:b.start_at,end_at:b.end_at,total_price:b.total_price,confirmation_email_status:email_status});
 }catch(e) {
  const m=e instanceof Error?e.message:"Could not save booking. Please try again.";
  const safe=/required|Please enter|Invalid|notice|closed|unavailable|outside|taken|already been used|Nail art|missing/i.test(m)?m:"Could not save booking. Please try again.";
  return json({error:safe},/taken|already been used/i.test(m)?409:400);
 }
});