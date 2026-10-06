import {describe,it,expect} from 'vitest'
import {readDrafts,storeDraft,deleteDraft,recoveryKey,RECOVERY_MAX_AGE,type LocalDraft} from '@/lib/draftRecovery'
function memory():Storage {
 const data=new Map<string,string>()
 return {get length(){return data.size},key:i=>[...data.keys()][i]??null,getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v)},removeItem:k=>{data.delete(k)},clear:()=>data.clear()}
}
const draft:LocalDraft={userId:'writer',articleId:'article',tabId:'tab',at:Date.now(),baseVersion:'old',fields:{title:'Unsaved title',content:'unsaved exact text',slug:'draft',excerpt:'excerpt',coverImage:'',categoryId:'',tags:['local'],authorId:'writer'}}
describe('persistent draft recovery',()=>{
 it('preserves exact fields across storage readers',()=>{const storage=memory();storeDraft(storage,draft);expect(readDrafts(storage,'writer','article')).toEqual([draft])})
 it('never offers another account or article',()=>{const storage=memory();storeDraft(storage,draft);expect(readDrafts(storage,'reader','article')).toEqual([]);expect(readDrafts(storage,'writer','other')).toEqual([])})
 it('keeps separate tab copies and removes only the chosen copy',()=>{const storage=memory();storeDraft(storage,draft);storeDraft(storage,{...draft,tabId:'other'});deleteDraft(storage,draft);expect(readDrafts(storage,'writer','article')).toHaveLength(1)})
 it('does not apply expired, future or malformed records',()=>{const storage=memory();for(const at of [Date.now()-RECOVERY_MAX_AGE-1000,Date.now()+10000]){storeDraft(storage,{...draft,at});expect(readDrafts(storage,'writer','article')).toEqual([])};storage.setItem(recoveryKey(draft),'{broken');expect(readDrafts(storage,'writer','article')).toEqual([])})
 it('cannot smuggle mismatched ownership through a key',()=>{const storage=memory();storage.setItem(recoveryKey(draft),JSON.stringify({...draft,userId:'reader'}));expect(readDrafts(storage,'reader','article')).toEqual([])})
})
