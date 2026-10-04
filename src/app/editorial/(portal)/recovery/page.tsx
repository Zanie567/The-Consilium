import {getServerSession} from 'next-auth'
import {redirect} from 'next/navigation'
import {authOptions} from '@/lib/auth'
import {DraftRecoveryList} from '@/components/editorial/DraftRecoveryList'
export default async function RecoveryPage(){
 const session=await getServerSession(authOptions)
 if(!session)redirect('/editorial/login')
 if(!['ADMIN','EDITOR','WRITER'].includes(session.user.role))redirect('/editorial')
 return <DraftRecoveryList userId={session.user.id}/>
}
