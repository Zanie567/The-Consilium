import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

export default async function AdminEditArticleRedirect({ params }: Props) {
  const { id } = await params
  redirect(`/editorial/articles/${id}/edit`)
}
