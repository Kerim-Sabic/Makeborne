/* eslint-disable @typescript-eslint/no-require-imports -- Disposable local source fixture. */
const {randomUUID}=require('node:crypto');
function createNativeSlideFixture(){
 const blocks=[{id:randomUUID(),type:'paragraph',text:'Start with useful product details and an unmistakable point of view.',assetId:null,locked:false,sourceIds:[]},{id:randomUUID(),type:'quote',text:'A proposed creative direction. All product details need owner approval.',assetId:null,locked:false,sourceIds:[]}];
 const text=(source,box,fontSize,font='body',color)=>({id:randomUUID(),kind:'text',source,...box,fontSize,lineHeight:1.3,font,weight:'regular',align:'left',...(color?{color}:{})});
 const content={schemaVersion:1,title:'Good Dog creative direction',kind:'presentation',sections:[{id:randomUUID(),title:'Every walk starts somewhere.',blocks,slideDesign:{schemaVersion:1,background:'#F4F0E7',elements:[
  text({kind:'title'},{x:80,y:76,width:1040,height:220},84,'heading'),
  text({kind:'block',blockId:blocks[0].id},{x:80,y:388,width:500,height:200},32),
  text({kind:'block',blockId:blocks[1].id},{x:728,y:424,width:440,height:160},28,'body','#45665A'),
 ]}}]};
 const style={id:'native-custom-fixture',name:'Custom editorial direction',version:1,description:'Disposable local composition fixture',typography:{headingFont:'Georgia',bodyFont:'Arial'},colors:{canvas:'#F8F7F4',ink:'#242A26',accent:'#45665A'},referenceAssetIds:[]};
 return {content,style};
}
module.exports={createNativeSlideFixture};
