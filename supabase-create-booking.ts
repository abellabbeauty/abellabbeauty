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
function emailBody(b:any,event:"confirmed"|"cancelled"|"rescheduled"="confirmed") {
 const cancelled=event==="cancelled",rescheduled=event==="rescheduled";
 const heading=cancelled?"Booking cancelled":rescheduled?"Appointment updated ♡":"Booking confirmed ♡";
 const message=cancelled?"your appointment has been cancelled. You no longer need to attend this appointment.":rescheduled?"your appointment date or time has changed. Please use the updated details below.":"your appointment has been booked successfully.";
 const date=new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date(b.start_at));
 const time=new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",hour:"numeric",minute:"2-digit",hour12:true}).format(new Date(b.start_at));
 const total=new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD"}).format(Number(b.total_price));
 const extras=(b.service_details?.addons||[]).map((a:any)=>a.name+(a.quantity?" × "+a.quantity:"")).join(", ")||"None";
 const previous=b.reschedule_previous_start_at?new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Sydney",weekday:"long",day:"numeric",month:"long",year:"numeric",hour:"numeric",minute:"2-digit",hour12:true}).format(new Date(b.reschedule_previous_start_at)):null;
 const rows=[...(rescheduled&&previous?[["Previous appointment",previous+" (Sydney local time)"]]:[]),["Service",b.service_name],["Customisations",extras],[rescheduled?"New date":"Date",date],[rescheduled?"New time":"Time",time+" (Sydney local time)"],...(!cancelled?[["Amount due at appointment",total]]:[]),["Booking reference",b.id]];
 const policy="Please provide at least 24 hours’ notice to cancel or reschedule.";
 const footer=cancelled?"Please contact abellabbeauty if you would like to arrange another appointment.":policy;
 const text="abellabbeauty — "+heading+"\nHi "+b.client_name+", "+message+"\n"+rows.map(([k,v])=>k+": "+v).join("\n")+(!cancelled?"\nAppointment location: "+ADDRESS:"")+"\n"+footer+"\nContact: "+REPLY;
 const html='<!doctype html><html><body style="margin:0;background:#fbf6f3;font-family:Arial,sans-serif;color:#241d1d"><div style="max-width:620px;margin:auto;padding:32px 18px"><div style="background:white;border:1px solid #ead8d8;border-radius:20px;padding:28px"><div style="text-align:center;font:30px Georgia,serif">abellabbeauty</div><h1 style="font-size:24px;text-align:center">'+esc(heading)+'</h1><p>Hi '+esc(b.client_name)+', '+esc(message)+'</p><table style="width:100%;border-collapse:collapse">'+rows.map(([k,v])=>'<tr><td style="padding:12px 4px;border-top:1px solid #f0e1e1">'+esc(k)+'</td><td style="padding:12px 4px;border-top:1px solid #f0e1e1;text-align:right;overflow-wrap:anywhere">'+esc(v)+'</td></tr>').join('')+'</table>'+(!cancelled?'<div style="background:#fff6f7;border-radius:14px;padding:16px;margin-top:24px"><strong>Appointment location</strong><br>'+esc(ADDRESS)+'</div>':'')+'<p style="line-height:1.6">'+esc(footer)+'</p><p>Contact <a href="mailto:'+esc(REPLY)+'">'+esc(REPLY)+'</a> if you need help.</p></div></div></body></html>';
 return {html,text};
}
async function sendEmail(b:any,event:"confirmed"|"cancelled"|"rescheduled") {
 const prefix=event==="cancelled"?"cancellation":event==="rescheduled"?"reschedule":"confirmation";
 if(event==="rescheduled"&&!b.reschedule_revision)return "skipped";
 if(b[prefix+"_email_status"]==="sent")return "sent";
 const latest=(await db("bookings?id=eq."+b.id+"&select=booking_status,start_at,reschedule_revision"))[0];
 if(event==="rescheduled"){
  if(!["pending","confirmed"].includes(latest?.booking_status)||latest.reschedule_revision!==b.reschedule_revision)return "skipped";
 }else if(latest?.booking_status!==event||new Date(latest.start_at).getTime()!==new Date(b.start_at).getTime())return "skipped";
 const {html,text}=emailBody(b,event);
 const receiptPath="bookings?id=eq."+b.id+(event==="rescheduled"?"&reschedule_revision=eq."+b.reschedule_revision:"");
 const payload=JSON.stringify({timestamp:Date.now(),booking_id:b.id,event,revision:event==="rescheduled"?b.reschedule_revision:null,to:b.client_email,subject:"Booking "+event+" — "+b.service_name,html,text});
 try {
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(GMAIL_RELAY_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(payload)))).map(n=>n.toString(16).padStart(2,"0")).join("");
  const r=await fetch(GMAIL_RELAY_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({payload,signature}),signal:AbortSignal.timeout(45000)});
  const result=await r.json();
  if(r.ok&&result.ok===true&&result.status==="sent"&&result.booking_id===b.id&&result.event===event&&result.owner_copy===true&&(event!=="rescheduled"||result.revision===b.reschedule_revision)){
   await db(receiptPath,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({[prefix+"_email_status"]:"sent",[prefix+"_email_sent_at"]:new Date().toISOString(),[prefix+"_email_id"]:"gmail/"+event+"/"+(event==="rescheduled"?b.reschedule_revision:b.id)})});
   return "sent";
  }
  console.error("Booking notification not accepted",b.id,event,result.error||"unknown");
 }catch{console.error("Booking notification request failed",b.id,event);}
 await db(receiptPath,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({[prefix+"_email_status"]:"failed"})}).catch(()=>{});
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
  if(p.action==="retry_email"||p.action==="update_booking_status"||p.action==="reschedule_booking") {
   const auth=await fetch(URL+"/auth/v1/user",{headers:{apikey:ROLE,Authorization:req.headers.get("Authorization")||""}});
   const user=await auth.json();if(!auth.ok||user.id!==ADMIN)return json({error:"Unauthorised"},403);
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.booking_id||""))return json({error:"Invalid reference"},400);
   b=(await db("bookings?id=eq."+p.booking_id+"&select=*"))[0];
   if(!b)return json({error:"Booking not found"},404);
   if(p.action==="reschedule_booking"){
    b=await db("rpc/admin_reschedule_booking",{method:"POST",headers:{Authorization:req.headers.get("Authorization")||""},body:JSON.stringify({p_booking_id:p.booking_id,p_start_at:p.start_at,p_original_start_at:p.original_start_at})});
   }
   if(p.action==="update_booking_status"){
    if(!["confirmed","cancelled"].includes(p.booking_status))return json({error:"Invalid booking status"},400);
    if(b.booking_status!==p.booking_status){
     const changed=await db("bookings?id=eq."+p.booking_id,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({booking_status:p.booking_status})});
     b=changed[0];
    }
   }
   if(!["confirmed","cancelled"].includes(b.booking_status)&&!(b.booking_status==="pending"&&b.reschedule_revision))return json({error:"Booking has no confirmation or cancellation to send"},400);
  } else {
   if(p.action)return json({error:"Invalid action"},400);
   if(p.agreed_to_policies!==true) return json({error:"Please agree to the booking policies."},400);
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.request_id||"")) return json({error:"Invalid booking request. Please refresh."},400);
   b=await db("rpc/create_direct_booking",{method:"POST",body:JSON.stringify({p_request_id:p.request_id,p_client_name:p.client_name,p_client_email:p.client_email,p_client_phone:p.client_phone,p_service_key:p.service_key,p_full_design:p.full_design,p_addons:p.addons,p_removal:p.removal,p_start_at:p.start_at,p_notes:p.notes||null})});
  }
  const event=b.booking_status==="cancelled"?"cancelled":b.reschedule_revision&&(p.action==="reschedule_booking"||p.action==="retry_email")?"rescheduled":"confirmed";
  const email_status=await sendEmail(b,event);
  return json({booking_id:b.id,booking_status:b.booking_status,service_name:b.service_name,start_at:b.start_at,end_at:b.end_at,total_price:b.total_price,confirmation_email_status:event==="confirmed"?email_status:b.confirmation_email_status,cancellation_email_status:event==="cancelled"?email_status:b.cancellation_email_status,reschedule_email_status:event==="rescheduled"?email_status:b.reschedule_email_status,notification_email_status:email_status});
 }catch(e) {
  const m=e instanceof Error?e.message:"Could not save booking. Please try again.";
  const safe=/required|Please enter|Invalid|notice|closed|unavailable|outside|taken|already been used|Nail art|missing|appointment|overlap|refresh|choose/i.test(m)?m:"Could not save booking. Please try again.";
  return json({error:safe},/taken|already been used/i.test(m)?409:400);
 }
});