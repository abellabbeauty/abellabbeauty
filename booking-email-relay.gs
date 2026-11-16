/** abellabbeauty booking confirmations. Send-only Google Mail permission. */
function doGet() { return json_({service:'abellabbeauty booking notifications',ready:true}); }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function doPost(e) {
  let lock;
  try {
    const raw=e && e.postData && e.postData.contents;
    if(!raw || raw.length>30000) return json_({ok:false,error:'Invalid request'});
    const envelope=JSON.parse(raw), secret=PropertiesService.getScriptProperties().getProperty('BOOKING_RELAY_SECRET');
    if(!secret || typeof envelope.payload!=='string' || typeof envelope.signature!=='string'){console.warn('Relay authentication: configuration or envelope missing');return json_({ok:false,error:'Unauthorised'});}
    const expected=Utilities.computeHmacSha256Signature(envelope.payload,secret,Utilities.Charset.UTF_8).map(n=>('0'+((n+256)%256).toString(16)).slice(-2)).join('');
    let mismatch=expected.length^envelope.signature.length;
    for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^(envelope.signature.charCodeAt(i)||0);
    if(mismatch){console.warn('Relay authentication: signature mismatch');return json_({ok:false,error:'Unauthorised'});}
    const p=JSON.parse(envelope.payload);
    const event=p.event||'confirmed',owner='abellaattoo@gmail.com';
    if(!['confirmed','cancelled','rescheduled'].includes(event))return json_({ok:false,error:'Invalid notification event'});
    if(event==='rescheduled'&&!/^[0-9a-f-]{36}$/i.test(p.revision||''))return json_({ok:false,error:'Invalid update reference'});
    if(!Number.isFinite(p.timestamp)||Math.abs(Date.now()-p.timestamp)>300000)return json_({ok:false,error:'Expired request'});
    if(!/^[0-9a-f-]{36}$/i.test(p.booking_id)||typeof p.to!=='string'||!p.to.match(/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/)||typeof p.text!=='string'||typeof p.html!=='string'||typeof p.subject!=='string'||!p.subject.startsWith('Booking '+event))return json_({ok:false,error:'Invalid confirmation'});
    lock=LockService.getScriptLock();
    if(!lock.tryLock(10000))return json_({ok:false,error:'Busy',retryable:true});
    const props=PropertiesService.getScriptProperties(),key=(event==='confirmed'?'sent_':event==='cancelled'?'sent_cancelled_':'sent_rescheduled_')+p.booking_id+(event==='rescheduled'?'_'+p.revision:''),copyKey=key+'_owner',existing=props.getProperty(key);
    if(existing&&props.getProperty(copyKey))return json_({ok:true,status:'sent',booking_id:p.booking_id,event:event,revision:p.revision||null,owner_copy:true});
    const recipients=existing||p.to.toLowerCase()===owner?1:2;
    if(MailApp.getRemainingDailyQuota()<recipients)return json_({ok:false,error:'Daily email limit reached',retryable:true});
    const email={to:existing?owner:p.to,subject:p.subject,body:p.text,htmlBody:p.html,name:'abellabbeauty',replyTo:owner};
    if(!existing&&p.to.toLowerCase()!==owner)email.bcc=owner;
    MailApp.sendEmail(email);
    props.setProperty(key,String(Date.now()));props.setProperty(copyKey,String(Date.now()));
    // Retain duplicate protection for 90 days and bound property storage.
    const all=props.getProperties(); Object.keys(all).forEach(k=>{if(k.startsWith('sent_')&&Number(all[k])<Date.now()-90*86400000)props.deleteProperty(k);});
    return json_({ok:true,status:'sent',booking_id:p.booking_id,event:event,revision:p.revision||null,owner_copy:true});
  } catch(err) { return json_({ok:false,error:'Confirmation email unavailable',retryable:true}); }
  finally { if(lock)lock.releaseLock(); }
}

// Sends clearly labelled samples only to the business owner; never changes a booking.
function sendNotificationSamples() {
  const props=PropertiesService.getScriptProperties();
  const id=props.getProperty('NOTIFICATION_SAMPLE_ID')||Utilities.getUuid();
  props.setProperty('NOTIFICATION_SAMPLE_ID',id);
  ['confirmed','cancelled'].forEach(event=>{
    const subject='Booking '+event+' — TEST notification';
    const text='TEST ONLY — no appointment has been created or cancelled.\n\nHi Abella, this is a sample '+event+' email from your booking website.\nService: Shellac Manicure\nExample appointment: Friday 20 November 2026 at 9:00 am (Sydney time).\n'+(event==='confirmed'?'Example price: $35.':'This sample shows the cancellation notice.')+'\n\nFuture booking '+(event==='confirmed'?'confirmations':'cancellations')+' will be emailed to the client and copied to abellaattoo@gmail.com.';
    const html='<div style="font-family:Arial,sans-serif;max-width:600px;padding:24px;background:#fff6f7"><h2>abellabbeauty</h2><h3>'+subject+'</h3><p>'+text.replace(/\n/g,'<br>')+'</p></div>';
    const payload=JSON.stringify({timestamp:Date.now(),booking_id:id,event:event,to:'abellaattoo@gmail.com',subject:subject,text:text,html:html});
    const secret=props.getProperty('BOOKING_RELAY_SECRET');
    const signature=Utilities.computeHmacSha256Signature(payload,secret,Utilities.Charset.UTF_8).map(n=>('0'+((n+256)%256).toString(16)).slice(-2)).join('');
    const result=JSON.parse(doPost({postData:{contents:JSON.stringify({payload:payload,signature:signature})}}).getContent());
    if(!result.ok)throw new Error('Sample '+event+' failed: '+result.error);
    console.log('Sample '+event+': '+result.status+'; owner copy: '+result.owner_copy);
  });
}

// Owner-only sample; no booking is changed.
function sendRescheduleSample() {
 const props=PropertiesService.getScriptProperties();
 const id=props.getProperty('RESCHEDULE_SAMPLE_ID')||Utilities.getUuid();
 props.setProperty('RESCHEDULE_SAMPLE_ID',id);
 const subject='Booking rescheduled — TEST notification';
 const text='TEST ONLY — no appointment has been changed.\n\nHi Abella, this is an appointment update sample.\nPrevious appointment: Friday 20 November 2026 at 9:00 am\nNew appointment: Friday 20 November 2026 at 10:00 am\nService: Shellac Manicure\nAll times are Sydney local time.\n\nFuture appointment moves will email the updated details to the client and copy abellaattoo@gmail.com.';
 const html='<div style="font-family:Arial,sans-serif;max-width:600px;padding:24px;background:#fff6f7"><h2>abellabbeauty</h2><h3>Appointment updated — TEST</h3><p>'+text.replace(/\n/g,'<br>')+'</p></div>';
 const payload=JSON.stringify({timestamp:Date.now(),booking_id:id,event:'rescheduled',revision:id,to:'abellaattoo@gmail.com',subject:subject,text:text,html:html});
 const signature=Utilities.computeHmacSha256Signature(payload,props.getProperty('BOOKING_RELAY_SECRET'),Utilities.Charset.UTF_8).map(n=>('0'+((n+256)%256).toString(16)).slice(-2)).join('');
 const result=JSON.parse(doPost({postData:{contents:JSON.stringify({payload:payload,signature:signature})}}).getContent());
 if(!result.ok)throw new Error('Update sample failed: '+result.error);
 console.log('Reschedule sample: '+result.status+'; owner copy: '+result.owner_copy);
}
