import type { InteractiveContent } from '@/lib/types/stage';
import { LINE_STOP_001_SCENARIO_ID } from './scenarios';
import { buildLineStop001Html } from './scenarios/line-stop-001-html';
import type { MechLabActivityContext } from './types';

export interface MechIframeProtocol {
  source: string;
  version: string;
  readyType: string;
  actionType: string;
  stateChangedType: string;
  resetType: string;
}

const formalProtocol: MechIframeProtocol = {
  source: 'zhiban-virtual-lab',
  version: '1.0',
  readyType: 'MECH_READY',
  actionType: 'MECH_ACTION',
  stateChangedType: 'MECH_STATE_CHANGED',
  resetType: 'MECH_RESET',
};

/**
 * Self-contained HTML used by the formal Virtual Lab and the retained technical
 * validation page. It deliberately uses native WebGL so this capability check
 * introduces no runtime dependency or production machine model.
 */
export function buildMechInteractiveHtml({
  title,
  activityId,
  scenarioId,
  protocol = formalProtocol,
}: {
  title: string;
  activityId: string;
  scenarioId: string;
  protocol?: MechIframeProtocol;
}): string {
  const config = JSON.stringify({ activityId, scenarioId, protocol });
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;overflow:hidden;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;background:radial-gradient(circle at 30% 0%,#1d4ed8 0,#07111f 48%,#020617 100%);color:#e2e8f0}#app{display:grid;grid-template-rows:auto 1fr;min-height:100vh}header{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;background:#081326cc;border-bottom:1px solid #334155}h1{margin:0;font-size:16px}#state{color:#86efac;font-size:13px}#viewport{position:relative;min-height:0;touch-action:none}canvas{display:block;width:100%;height:100%;cursor:grab;outline:none}canvas:active{cursor:grabbing}.panel{position:absolute;left:16px;bottom:16px;max-width:330px;padding:12px;border:1px solid #475569;border-radius:10px;background:#0f172ae8;box-shadow:0 14px 32px #0008;font-size:13px;line-height:1.55}button{margin-top:8px;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;font:inherit;font-weight:700;color:white;background:#dc2626}.hint{color:#cbd5e1;margin:0}
</style></head><body><main id="app"><header><h1>${title} · Interactive HTML + WebGL</h1><span id="state">旋转中</span></header><section id="viewport"><canvas id="scene" aria-label="box 与 cylinder 的 3D 场景"></canvas><div class="panel"><p class="hint">拖动鼠标旋转视角，滚轮缩放。蓝色对象为 box，橙色对象为 cylinder。</p><button id="fault" type="button">模拟故障</button></div></section></main>
<script>(function(){
var cfg=${config},canvas=document.getElementById('scene'),stateNode=document.getElementById('state'),gl=canvas.getContext('webgl',{antialias:true}),rotating=true,fault=false,yaw=-.55,pitch=.38,distance=7.2,drag=null,angle=0;
function post(type,payload){window.parent.postMessage({source:cfg.protocol.source,version:cfg.protocol.version,type:type,activityId:cfg.activityId,scenarioId:cfg.scenarioId,timestamp:new Date().toISOString(),payload:payload||{}},'*')}
if(!gl){stateNode.textContent='WebGL 不可用';post(cfg.protocol.actionType,{action:'observe',detail:'webgl_unavailable'});return}
var vertex='attribute vec3 p;attribute vec3 c;uniform mat4 m;varying vec3 v;void main(){gl_Position=m*vec4(p,1.0);v=c;}',fragment='precision mediump float;varying vec3 v;void main(){gl_FragColor=vec4(v,1.0);}';
function shader(type,source){var s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s}var program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);var pLoc=gl.getAttribLocation(program,'p'),cLoc=gl.getAttribLocation(program,'c'),mLoc=gl.getUniformLocation(program,'m');
function cube(){var q=[-1,-1,-1,1,-1,-1,1,1,-1,-1,1,-1,-1,-1,1,1,-1,1,1,1,1,-1,1,1],f=[[0,1,2,0,2,3],[1,5,6,1,6,2],[5,4,7,5,7,6],[4,0,3,4,3,7],[3,2,6,3,6,7],[4,5,1,4,1,0]],o=[];for(var i=0;i<f.length;i++)for(var j=0;j<f[i].length;j++){var n=f[i][j]*3;o.push(q[n],q[n+1],q[n+2])}return o}function cylinder(){var o=[],n=28;for(var i=0;i<n;i++){var a=i*Math.PI*2/n,b=(i+1)*Math.PI*2/n,x=Math.cos(a),z=Math.sin(a),X=Math.cos(b),Z=Math.sin(b);o.push(x,-1,z,X,-1,Z,X,1,Z,x,-1,z,X,1,Z,x,1,z,0,1,0,X,1,Z,x,1,z,0,-1,0,x,-1,z,X,-1,Z)}return o}
function shape(v,color){var colors=[];for(var i=0;i<v.length/3;i++)colors.push(color[0],color[1],color[2]);var pb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,pb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(v),gl.STATIC_DRAW);var cb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,cb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(colors),gl.DYNAMIC_DRAW);return{pb:pb,cb:cb,count:v.length/3,base:color}}var box=shape(cube(),[.18,.64,1]),cyl=shape(cylinder(),[1,.44,.16]);
function id(){return[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}function mul(a,b){var o=[];for(var c=0;c<4;c++)for(var r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o}function tr(x,y,z){var m=id();m[12]=x;m[13]=y;m[14]=z;return m}function sc(x,y,z){var m=id();m[0]=x;m[5]=y;m[10]=z;return m}function rx(a){var c=Math.cos(a),s=Math.sin(a);return[1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1]}function ry(a){var c=Math.cos(a),s=Math.sin(a);return[c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]}function perspective(f,a,n,r){var x=1/Math.tan(f/2),q=1/(n-r);return[x/a,0,0,0,0,x,0,0,0,0,(r+n)*q,-1,0,0,2*r*n*q,0]}
function resize(){var d=Math.min(window.devicePixelRatio||1,2),w=Math.max(1,canvas.clientWidth*d),h=Math.max(1,canvas.clientHeight*d);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}gl.viewport(0,0,w,h);return w/h}function draw(s,m,color){var colors=[];for(var i=0;i<s.count;i++)colors.push(color[0],color[1],color[2]);gl.bindBuffer(gl.ARRAY_BUFFER,s.pb);gl.enableVertexAttribArray(pLoc);gl.vertexAttribPointer(pLoc,3,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,s.cb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(colors),gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(cLoc);gl.vertexAttribPointer(cLoc,3,gl.FLOAT,false,0,0);gl.uniformMatrix4fv(mLoc,false,new Float32Array(m));gl.drawArrays(gl.TRIANGLES,0,s.count)}
function frame(time){var view=mul(perspective(.88,resize(),.1,100),mul(tr(0,0,-distance),mul(rx(pitch),ry(yaw))));if(rotating)angle=time*.001;gl.enable(gl.DEPTH_TEST);gl.clearColor(.02,.07,.14,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);draw(box,mul(view,mul(tr(-1.6,0,0),mul(ry(angle),sc(1.15,1.15,1.15)))),fault?[1,.12,.12]:box.base);draw(cyl,mul(view,mul(tr(1.55,0,0),mul(ry(-angle*1.35),sc(.92,1.38,.92)))),fault?[1,.74,.08]:cyl.base);requestAnimationFrame(frame)}
canvas.addEventListener('pointerdown',function(e){drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId)});canvas.addEventListener('pointermove',function(e){if(!drag)return;yaw+=(e.clientX-drag.x)*.012;pitch=Math.max(-1.25,Math.min(1.25,pitch+(e.clientY-drag.y)*.012));drag={x:e.clientX,y:e.clientY}});canvas.addEventListener('pointerup',function(){drag=null});canvas.addEventListener('wheel',function(e){e.preventDefault();distance=Math.max(3.2,Math.min(13,distance+e.deltaY*.008))},{passive:false});
document.getElementById('fault').addEventListener('click',function(){fault=true;stateNode.textContent='故障已模拟：等待宿主命令';stateNode.style.color='#fca5a5';post(cfg.protocol.actionType,{action:'simulate_fault',detail:'box 状态已置为故障'});post(cfg.protocol.stateChangedType,{status:'fault_simulated',rotation:rotating?'running':'stopped',detail:'3D 对象已改变状态'})});
window.addEventListener('message',function(e){var d=e.data||{};if(d.source!==cfg.protocol.source||d.version!==cfg.protocol.version||d.type!==cfg.protocol.resetType||d.activityId!==cfg.activityId||d.scenarioId!==cfg.scenarioId)return;if(cfg.protocol.source==='zhiban-mech-validation'){var command=d.command;if(command==='stop_rotation'){rotating=false;stateNode.textContent='已收到命令：旋转停止';stateNode.style.color='#fbbf24'}if(command==='resume_rotation'){rotating=true;fault=false;stateNode.textContent='已收到命令：旋转恢复';stateNode.style.color='#86efac'}post(cfg.protocol.stateChangedType,{command:command,status:rotating?'rotating':'stopped'});return}fault=false;rotating=true;stateNode.textContent='已重置：旋转中';stateNode.style.color='#86efac';post(cfg.protocol.stateChangedType,{status:'reset',rotation:'running',detail:'3D 场景已重置'})});
post(cfg.protocol.readyType,{status:'ready',rotation:'running',detail:'WebGL box/cylinder 已渲染'});requestAnimationFrame(frame)})()</script></body></html>`;
}

export function createMechLabInteractiveContent(context: MechLabActivityContext): InteractiveContent {
  if (context.scenarioId === LINE_STOP_001_SCENARIO_ID) {
    return {
      type: 'interactive',
      url: '',
      html: buildLineStop001Html(context),
      widgetType: 'visualization3d',
      widgetConfig: {
        type: 'visualization3d',
        visualizationType: 'custom',
        description: '自动输送系统正常运行虚拟实训：传感、PLC 控制与执行机构联动。',
        objects: [
          { id: 'conveyor', type: 'box' }, { id: 'workpiece', type: 'box' },
          { id: 's1', type: 'cylinder' }, { id: 's2', type: 'cylinder' },
          { id: 'motor', type: 'cylinder', animation: { type: 'rotate', speed: 1, axis: 'z' } },
          { id: 'plc', type: 'box' }, { id: 'cylinder', type: 'cylinder' },
        ],
        interactions: [
          { type: 'orbit', target: 'camera', label: '旋转视角' },
          { type: 'zoom', target: 'camera', label: '缩放视角' },
          { type: 'button', target: 'conveyor', label: '启动系统' },
        ],
      },
    };
  }
  return {
    type: 'interactive',
    url: '',
    html: buildMechInteractiveHtml({
      title: context.title,
      activityId: context.activityId,
      scenarioId: context.scenarioId,
    }),
    widgetType: 'visualization3d',
    widgetConfig: {
      type: 'visualization3d',
      visualizationType: 'custom',
      description: 'Virtual Lab 最小场景：可旋转 box、cylinder、视角控制与标准化消息。',
      objects: [
        { id: 'mech-lab-box', type: 'box', animation: { type: 'rotate', speed: 1, axis: 'y' } },
        { id: 'mech-lab-cylinder', type: 'cylinder', animation: { type: 'rotate', speed: 1.35, axis: 'y' } },
      ],
      interactions: [
        { type: 'orbit', target: 'camera', label: '旋转视角' },
        { type: 'zoom', target: 'camera', label: '缩放视角' },
        { type: 'button', target: 'mech-lab-box', label: '模拟故障' },
      ],
    },
  };
}

/**
 * Reuses the formal line-stop scene in a deliberately read-only learning mode.
 * The scene geometry, camera controls, picking, and iframe protocol stay shared;
 * only the diagnostic controls are hidden so Station 01 remains about recognising
 * system components rather than completing a fault-training task.
 */
export function createMechSystemRecognitionInteractiveContent(
  context: MechLabActivityContext,
): InteractiveContent {
  const formalContent = createMechLabInteractiveContent(context);
  if (!formalContent.html || context.scenarioId !== LINE_STOP_001_SCENARIO_ID) return formalContent;

  const recognitionStyle = `<style data-system-recognition-mode>
#plcPanel,#meterPanel,#diagnosisPanel,#diagnosisNext,.teach,.device,.record,#deviceActions,
#start,#pause,#requestHint,#restart,#reset{display:none!important}
#phase{display:none!important}
.controls{left:auto;right:14px;bottom:14px;transform:none;width:auto;max-width:none;padding:0}
#camera{margin:0;background:#123b60}
</style>`;

  return {
    ...formalContent,
    html: formalContent.html
      .replace('</head>', `${recognitionStyle}</head>`)
      .replace(
        '<h1>自动输送系统 · S2故障诊断虚拟实训</h1>',
        `<h1>${context.title}</h1>`,
      )
      .replace('<span id="phase">任务准备</span>', '<span id="phase">设备探索</span>'),
  };
}

export const mechValidationProtocol: MechIframeProtocol = {
  source: 'zhiban-mech-validation',
  version: '1.0',
  readyType: 'MECH_TEST_READY',
  actionType: 'MECH_TEST_ACTION',
  stateChangedType: 'MECH_TEST_COMMAND_ACK',
  resetType: 'MECH_TEST_COMMAND',
};
