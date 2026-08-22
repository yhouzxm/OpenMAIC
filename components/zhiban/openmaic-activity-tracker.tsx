'use client';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { ClassroomEventType } from '@/lib/zhiban/classroom';
export function OpenMaicActivityTracker({courseId,activityId}:{courseId:string;activityId:string}){
 const started=useRef(false),completed=useRef(false);
 const post=useCallback(async(eventType:ClassroomEventType,sceneId?:string,payload:Record<string,unknown>={})=>{const response=await fetch(`/api/zhiban/openmaic-activities/${activityId}/session`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({courseId,eventId:crypto.randomUUID(),eventType,sceneId,payload,occurredAt:new Date().toISOString()})});if(!response.ok)return;const result=await response.json();if(result.completed&&!completed.current){completed.current=true;toast.success('OpenMAIC 活动已完成');}},[activityId,courseId]);
 useEffect(()=>{if(started.current)return;started.current=true;void fetch(`/api/zhiban/openmaic-activities/${activityId}/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({courseId})}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error??'活动会话启动失败');return post('scene_viewed');}).catch(error=>toast.error(error.message));},[activityId,courseId,post]);
 useEffect(()=>{const handler=(event:Event)=>{const detail=(event as CustomEvent<{type:ClassroomEventType;sceneId?:string;payload?:Record<string,unknown>}>).detail;if(detail?.type)void post(detail.type,detail.sceneId,detail.payload??{});};window.addEventListener('zhiban:classroom-interaction',handler);return()=>window.removeEventListener('zhiban:classroom-interaction',handler);},[post]);return null;
}
