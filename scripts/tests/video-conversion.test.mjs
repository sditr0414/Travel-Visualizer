import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createVideoConverter } from '../../server/video-conversion.mjs';
const execute=promisify(execFile);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,accept) { const deadline=Date.now()+30000;while(Date.now()<deadline){const value=read();if(accept(value))return value;await wait(20);}throw new Error('Timed out waiting for conversion'); }

test('single video copy preserves originals and metadata, avoids collisions and removes cancelled output', {timeout:60000}, async t=>{
 const root=await mkdtemp(join(tmpdir(),'travel-video-test-'));const outputs=join(root,'copies');const converter=createVideoConverter(outputs);
 t.after(async()=>{await converter.stop();await rm(root,{recursive:true,force:true});});
 if(!await converter.available()){t.skip('Optional local FFmpeg/ffprobe not installed');return;}
 const source=join(root,'촬영_20260410_091530.mp4');
 await execute('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=duration=8:size=960x540:rate=25','-c:v','libx264','-threads','2','-preset','ultrafast','-metadata','creation_time=2026-04-10T00:15:30Z','-metadata','location=+37.5000+127.0000/','-movflags','+use_metadata_tags',source],{timeout:30000});
 const before=await stat(source);const hash=()=>readFile(source).then(bytes=>createHash('sha256').update(bytes).digest('hex'));const originalHash=await hash();
 const item={path:source,kind:'video',size:before.size,lastModified:before.mtimeMs};const metadata={takenMs:Date.parse('2026-04-10T00:15:30Z'),lat:37.5,lng:127};
 const first=converter.start(item,metadata,true);
 assert.throws(()=>converter.start(item,metadata),/다른 영상/);
 const done=await until(()=>converter.get(first.id),job=>['complete','failed'].includes(job.state));assert.equal(done.state,'complete',done.error);
 const artifact=converter.artifact(first.id,'video');const sidecar=JSON.parse(await readFile(converter.artifact(first.id,'sidecar').path,'utf8'));
 assert.equal(sidecar.photoTakenTime.timestamp,String(metadata.takenMs/1000));assert.equal(sidecar.geoDataExif.latitude,37.5);
 const probe=JSON.parse((await execute('ffprobe',['-v','error','-show_format','-show_streams','-of','json',artifact.path])).stdout);
 assert.equal(probe.streams[0].codec_name,'h264');assert.ok(Math.abs(Number(probe.format.duration)-5)<0.1);
 assert.equal(Date.parse(probe.format.tags.creation_time),metadata.takenMs);assert.ok(probe.format.tags.location.includes('+37.5000'));
 assert.ok(Math.abs((await stat(artifact.path)).mtimeMs-before.mtimeMs)<1);
 const second=converter.start(item,metadata,true);await until(()=>converter.get(second.id),job=>job.state==='complete');
 assert.notEqual(converter.artifact(second.id,'video').path,artifact.path);
 assert.notEqual(converter.artifact(second.id,'video').name,artifact.name);
 const cancelling=converter.start(item,metadata,false);await until(()=>converter.get(cancelling.id),job=>job.state==='running');converter.cancel(cancelling.id);
 await until(()=>converter.get(cancelling.id),job=>job.state==='cancelled');
 await converter.stop();assert.equal(converter.artifact(cancelling.id,'video'),null);assert.equal((await readdir(outputs)).length,2);
 assert.equal(await hash(),originalHash);assert.equal((await stat(source)).mtimeMs,before.mtimeMs);
 assert.throws(()=>converter.start({...item,size:0,kind:'image'},metadata),/영상 한 개/);
});
