import { captureTimestamp, parseCaptureDateText, validCaptureTimeZone } from './capture-time';
import { parseFilenameTimestamp, parseJpegExif, parseQuickTimeMetadataChunks } from './media-metadata';
import { analyzeMediaFilesInline } from './media-analysis';
import { loadJourneyMedia } from './media-library';
import { loadLocalMediaManifest } from './local-media-library';
import { simplePlan } from '../test/fixtures';

function jpeg(zone?: string) {
  const tiff = new Uint8Array(130), view = new DataView(tiff.buffer);
  tiff.set([0x49,0x49]); view.setUint16(2,42,true); view.setUint32(4,8,true);
  view.setUint16(8,1,true); view.setUint16(10,0x8769,true); view.setUint16(12,4,true); view.setUint32(14,1,true); view.setUint32(18,26,true);
  view.setUint16(26,zone ? 2 : 1,true);
  const entry=(at:number,tag:number,text:string,offset:number)=>{view.setUint16(at,tag,true);view.setUint16(at+2,2,true);view.setUint32(at+4,text.length+1,true);view.setUint32(at+8,offset,true);tiff.set(new TextEncoder().encode(text),offset);};
  entry(28,0x9003,'2026:04:10 09:15:30',70);if(zone)entry(40,0x9011,zone,100);
  const bytes=new Uint8Array(142);bytes.set([255,216,255,225,0,138,69,120,105,102,0,0]);bytes.set(tiff,12);return bytes.buffer;
}
const quick=(date:string)=>[new TextEncoder().encode('com.apple.quicktime.creationdate\0'+date).buffer];

describe('capture time interpretation',()=>{
  it('changes only offset-less filename, EXIF and QuickTime wall times',()=>{
    const utc=Date.parse('2026-04-10T09:15:30Z'), kst=utc-9*3600000;
    expect(parseFilenameTimestamp('20260410_091530.jpg','Asia/Seoul')).toBe(kst);
    expect(parseJpegExif(jpeg(),'Asia/Seoul')?.takenMs).toBe(kst);
    expect(parseJpegExif(jpeg(),'UTC')?.takenMs).toBe(utc);
    expect(parseQuickTimeMetadataChunks(quick('2026-04-10T09:15:30'),'Asia/Seoul')?.takenMs).toBe(kst);
    expect(parseQuickTimeMetadataChunks(quick('2026-04-10T09:15:30'),'UTC')?.takenMs).toBe(utc);
    for(const zone of ['UTC','Asia/Seoul','America/New_York']) {
      expect(parseJpegExif(jpeg('+09:00'),zone)?.takenMs).toBe(kst);
      expect(parseQuickTimeMetadataChunks(quick('2026-04-10T09:15:30+09:00'),zone)?.takenMs).toBe(kst);
    }
  });
  it('validates zones, fractional offsets, impossible dates and DST boundaries',()=>{
    expect(validCaptureTimeZone('not/a-zone')).toBe(false);expect(validCaptureTimeZone('+14:30')).toBe(false);
    expect(parseCaptureDateText('2026-04-10T09:15:30.125','+05:30')).toBe(Date.parse('2026-04-10T03:45:30.125Z'));
    expect(captureTimestamp([2026,2,31,12,0,0],'UTC')).toBeNull();
    expect(captureTimestamp([2026,3,8,2,30,0],'America/New_York')).toBeNull();
    expect(captureTimestamp([2026,11,1,1,30,0],'America/New_York')).toBe(Date.parse('2026-11-01T05:30:00Z'));
  });
  it('retains absolute Takeout and filesystem timestamps',async()=>{
    const stamp=Date.parse('2026-04-10T00:05:00Z');
    const files=[new File(['png'],'plain.png',{type:'image/png',lastModified:stamp}),new File([JSON.stringify({title:'plain.png',photoTakenTime:{timestamp:String(stamp/1000)}})],'plain.png.json')];
    for(const zone of ['UTC','+09:00'])expect((await analyzeMediaFilesInline(files,undefined,undefined,zone))[0].takenMs).toBe(stamp);
    expect((await analyzeMediaFilesInline(files.slice(0,1),undefined,undefined,'+09:00'))[0].takenMs).toBe(stamp);
  });
  it('does not reuse a file-set or local cache interpreted in another zone',async()=>{
    const files=[new File(['png'],'20260410_090500.png',{type:'image/png'})];
    const first=await loadJourneyMedia(files,simplePlan(),undefined,undefined,'UTC');
    const next=await loadJourneyMedia(files,simplePlan(),undefined,undefined,'Asia/Seoul');
    expect(first.all[0].takenMs-next.all[0].takenMs).toBe(9*3600000);
    const request=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:200}));
    try {
      const local=await loadLocalMediaManifest({available:true,rootName:'photos',count:1,totalBytes:3,items:[{id:'1',kind:'image',name:files[0].name,size:3,lastModified:files[0].lastModified,metadata:{takenMs:first.all[0].takenMs,lat:null,lng:null,source:'filename-time',embeddedScanned:true,captureTimeZone:'UTC'}}]},simplePlan(),undefined,undefined,'Asia/Seoul');
      expect(local.all[0].takenMs).toBe(next.all[0].takenMs);
    } finally {request.mockRestore();}
  });
});

it('interprets offset-less local sidecar dates in the selected zone rather than the server zone', async()=>{
 const request=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:200}));
 try {
  const local=await loadLocalMediaManifest({available:true,rootName:'photos',count:1,totalBytes:3,items:[{id:'1',kind:'image',name:'plain.png',size:3,lastModified:0,metadata:{takenMs:Date.parse('2026-04-10T09:05:00Z'),lat:null,lng:null,source:'takeout-sidecar',embeddedScanned:true,captureDateText:'2026-04-10T09:05:00'}}]},simplePlan(),undefined,undefined,'Asia/Seoul');
  expect(local.all[0].takenMs).toBe(Date.parse('2026-04-10T00:05:00Z'));
 } finally {request.mockRestore();}
});
