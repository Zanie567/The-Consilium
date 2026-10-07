import {describe,it,expect} from 'vitest'
import {assertRunDatabase} from '../../scripts/lib/assertRunDatabase'
const url='postgresql://postgres@localhost:55445/consilium_audit_next_e2e_3357_1234'
const good={TEST_DATABASE_URL:url,DATABASE_URL:url,DIRECT_URL:url,E2E_RUN_ID:'next-e2e-3357-1234'}
describe('owned run database',()=>{
  it('attests the same disposable DB',()=>expect(()=>assertRunDatabase(good)).not.toThrow())
  it.each(['DATABASE_URL','DIRECT_URL','TEST_DATABASE_URL','E2E_RUN_ID'])('refuses mismatch of %s',key=>expect(()=>assertRunDatabase({...good,[key]:'postgresql://postgres@localhost:5433/consilium'})).toThrow())
  it('rejects a safe-host shared database',()=>expect(()=>assertRunDatabase({...good,DATABASE_URL:good.DATABASE_URL.replace('consilium_audit_next_e2e_3357_1234','consilium'),DIRECT_URL:good.DIRECT_URL.replace('consilium_audit_next_e2e_3357_1234','consilium'),TEST_DATABASE_URL:good.TEST_DATABASE_URL.replace('consilium_audit_next_e2e_3357_1234','consilium')})).toThrow('owned'))
})
