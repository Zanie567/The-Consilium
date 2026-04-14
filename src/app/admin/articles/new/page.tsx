import { redirect } from 'next/navigation'

export default function AdminNewArticleRedirect() {
  redirect('/editorial/articles/new')
}
