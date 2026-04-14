import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env.local') })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomUUID } from 'crypto'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! })
const prisma = new PrismaClient({ adapter })

// ── Tiptap content helpers ───────────────────────────────────────────────────

type TiptapNode =
  | { type: 'doc'; content: TiptapNode[] }
  | { type: 'paragraph'; content: TiptapNode[] }
  | { type: 'text'; text: string; marks?: { type: string }[] }
  | { type: 'heading'; attrs: { level: number }; content: TiptapNode[] }
  | { type: 'blockquote'; content: TiptapNode[] }

const p = (text: string): TiptapNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})

const h2 = (text: string): TiptapNode => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [{ type: 'text', text }],
})

const bq = (text: string): TiptapNode => ({
  type: 'blockquote',
  content: [p(text)],
})

const doc = (...nodes: TiptapNode[]): string =>
  JSON.stringify({ type: 'doc', content: nodes })

// ── Debate 1: Minimum Wage ───────────────────────────────────────────────────

const minWageForContent = doc(
  h2('The Case for Raising the Minimum Wage'),
  p('Decades of economic evidence challenge the textbook narrative that minimum wage increases inevitably destroy jobs. The experience of the UK since 1999 — and the US states that have raised their floors most aggressively — suggests that modest, phased increases can lift incomes without significant employment effects.'),
  p('The argument rests on monopsony power. Labour markets are not perfectly competitive. Employers in many sectors have significant wage-setting power, which they use to suppress pay below the competitive level. A minimum wage corrects this market failure rather than distorting an efficient market.'),
  bq('"A higher minimum wage is not charity — it is correcting a structural imbalance of bargaining power that has persisted for generations."'),
  h2('The Distributional Case'),
  p('Low-wage workers spend a higher share of their income than high-income households. A wage increase at the bottom therefore generates stronger multiplier effects through consumer spending, partially offsetting any employment cost. The fiscal argument is equally powerful: higher wages reduce the benefits bill, increase income tax and NICs receipts, and shrink the in-work poverty subsidy that taxpayers currently provide to low-wage employers.'),
  h2('International Evidence'),
  p('Germany introduced a statutory minimum wage in 2015, setting it at €8.50 per hour. Academic studies found employment effects to be negligible. New Zealand has repeatedly raised its minimum wage without triggering the job losses critics predicted. The fear of unemployment effects has consistently outpaced the reality.'),
  p('Critics rightly note that the UK labour market is heterogeneous. Sectors like hospitality, retail, and social care operate on thin margins. But the response to this is calibrated implementation — sector-specific transition periods, regional cost-of-living adjustments — not abandonment of the principle.'),
  h2('Conclusion'),
  p('Raising the minimum wage is not an ideological act. It is a pragmatic correction to a labour market that has, for too long, distributed the gains from growth inequitably. The evidence base for careful, phased increases is now substantial. The cost of inaction — poverty wages, in-work benefits dependency, weakened consumer demand — is higher than the cost of action.'),
)

const minWageAgainstContent = doc(
  h2('The Case Against a Higher Minimum Wage'),
  p('The intuition behind a higher minimum wage is straightforward: pay workers more. The economics are considerably more complicated. While advocates cite studies showing minimal employment effects, these findings depend heavily on local labour market conditions that do not hold uniformly across the UK.'),
  p('Price theory is unambiguous: when the price of something rises, demand for it falls. Labour is not exempt from this logic. The question is not whether a higher minimum wage reduces employment, but by how much, and for whom. The most vulnerable workers — those with low productivity, in marginal positions, in capital-intensive sectors — face the highest risk.'),
  bq('"The minimum wage is the most expensive way to help the poorest workers. There are better tools available."'),
  h2('Who Actually Benefits?'),
  p('Research consistently shows that minimum wage increases disproportionately benefit second earners in middle-income households — not the workers in deepest poverty, who are more likely to depend on welfare transfers than wages. Targeted benefits, the Earned Income Tax Credit model in the United States, or a negative income tax are better-targeted instruments for reducing poverty.'),
  h2('The Small Business Problem'),
  p('Large corporations — supermarkets, logistics companies, tech-enabled platforms — can absorb wage increases through automation and productivity investment. Small businesses in care, hospitality, and independent retail cannot. The effect of aggressive minimum wage increases is therefore to transfer market share from labour-intensive small enterprises to capital-intensive large ones, concentrating the economy rather than dispersing it.'),
  h2('Inflation and Real Wages'),
  p('A minimum wage increase that triggers a price-wage spiral produces nominal gains without real ones. Workers see their wages rise but find that the cost of the goods and services they purchase rises proportionately. The workers who gain, in real terms, are only those in sectors where firms absorb rather than pass on costs.'),
  h2('Conclusion'),
  p('The goal of raising living standards for the lowest-paid workers is one all serious economists share. The minimum wage is a blunt instrument for achieving it. The evidence base for significant job losses at higher rates is stronger than advocates admit, and better-targeted tools exist. Raising the minimum wage is popular politics. It is not necessarily good economics.'),
)

// ── Debate 2: AI Regulation ─────────────────────────────────────────────────

const aiRegForContent = doc(
  h2('Regulating Artificial Intelligence: An Economic Imperative'),
  p('The rapid proliferation of large language models, generative AI systems, and autonomous decision-making tools has outpaced the regulatory frameworks designed to govern them. The economic case for comprehensive AI regulation is not primarily about preventing science-fiction scenarios. It is about correcting real and present market failures.'),
  p('AI systems generate significant negative externalities. Algorithmic hiring tools encode historical discrimination. Credit scoring models amplify existing inequality. Recommendation systems optimise for engagement, not welfare. These are not hypothetical risks — they are documented harms that the market has shown no capacity to self-correct.'),
  bq('"Markets do not price the harms of AI that fall on those who have no voice in the transaction."'),
  h2('The Case for Regulatory Intervention'),
  p('Standard economic theory justifies regulation where markets fail — where prices do not reflect true social costs and benefits. AI creates a textbook case for intervention. The developers of AI systems capture the revenue from their deployment; the costs are distributed across workers displaced, individuals subjected to biased decisions, and societies exposed to misinformation. Pigouvian logic demands correction.'),
  h2('Liability and Accountability'),
  p('Currently, AI developers face limited liability for the downstream harms their systems cause. This is economically irrational: it systematically undersupplies safety and oversupplies capability. A robust regulatory framework — with clear liability standards, mandatory auditing, and enforcement — would internalise these costs, creating market incentives for safer development.'),
  h2('Competition and Concentration'),
  p('Without regulation, AI markets will consolidate rapidly. The economics of foundation models favour a handful of firms with access to compute and training data. This is not a prediction — it is already happening. Regulatory frameworks that mandate interoperability, require data access for challengers, and prevent anticompetitive bundling are essential to preserving the competitive dynamics from which innovation flows.'),
  h2('Conclusion'),
  p('Regulation of AI is not a choice between innovation and safety. It is a choice between markets that work and markets that fail. The economic case for intervention is strong, the tools are available, and the window for meaningful action is narrowing. Delay compounds the problem.'),
)

const aiRegAgainstContent = doc(
  h2('Against AI Regulation: The Innovation Cost We Cannot Afford'),
  p('The instinct to regulate AI is understandable. New technologies generate anxiety, and policymakers respond to anxiety with legislation. But good economic policy requires weighing costs against benefits, and the costs of premature, comprehensive AI regulation are substantial — while many of the claimed benefits are speculative.'),
  p('We are at an early and critical stage of AI development. The systems that exist today are capable but narrow; the systems being built now will be transformative. Locking in regulatory frameworks based on current capabilities risks both stifling beneficial innovation and failing to anticipate the actual risks of future systems.'),
  bq('"Regulating AI today is like regulating the internet in 1993 — we barely understood what it was."'),
  h2('The Innovation Cost'),
  p('Regulatory compliance has fixed costs. Large incumbents can absorb them; start-ups and academic researchers cannot. Comprehensive AI regulation therefore functions as a moat for the firms already dominant in the space — the exact opposite of the competitive outcome that regulation\'s advocates claim to want. The European Union\'s AI Act, well-intentioned as it is, has already driven several AI research groups to relocate to less regulated jurisdictions.'),
  h2('The Information Problem'),
  p('Regulators face severe information asymmetries. The technical complexity of modern AI systems exceeds the capacity of most regulatory agencies to evaluate them. This creates a regulatory capture risk: rules will be written by those who understand the technology, namely the large firms whose interest lies in creating compliance barriers.'),
  h2('Existing Laws Are Sufficient'),
  p('Most of the harms attributed to AI — discrimination, fraud, privacy violation — are already illegal. The problem is not absence of law but absence of enforcement. Dedicating regulatory energy to new AI-specific frameworks, rather than enforcing existing consumer protection, competition, and data protection law, is displacement activity.'),
  h2('Conclusion'),
  p('The economic history of technology regulation is not encouraging. We have consistently overestimated the risks of new technologies and underestimated the costs of constraining them. AI regulation should be targeted, light-touch, and adaptive — not the comprehensive framework being proposed, which will damage the UK\'s position in the most consequential technological race of our time.'),
)

// ── Debate 3: Free Trade ─────────────────────────────────────────────────────

const freeTradeForContent = doc(
  h2('In Defence of Free Trade'),
  p('The case for free trade is one of the most robust propositions in economics. From Ricardo\'s principle of comparative advantage to modern empirical work on trade openness and growth, the evidence is consistent: countries that trade freely are richer, more innovative, and — over time — more peaceful than those that do not.'),
  p('Trade enables specialisation. When countries focus on producing what they do relatively best, total output rises. The gains are not evenly distributed, and this is a legitimate concern. But the response to uneven distribution is redistribution policy, not protectionism. Abandoning the gains from trade to avoid redistribution is an economically illiterate trade.'),
  bq('"The gains from free trade are among the most thoroughly documented phenomena in all of economics."'),
  h2('Consumer Welfare'),
  p('Import restrictions raise prices for domestic consumers to protect domestic producers. This is a transfer — and a regressive one. Lower-income households spend a higher share of their income on tradeable goods. Tariffs on food, clothing, and electronics are effectively taxes on consumption, with the proceeds transferred to politically organised producers. The costs are diffuse; the benefits are concentrated.'),
  h2('Innovation and Productivity'),
  p('Trade exposure forces productivity improvements. Firms that face international competition cannot survive on domestic protection indefinitely. The empirical literature consistently finds that trade openness is associated with faster productivity growth, faster adoption of new technologies, and higher R&D investment. Protectionism preserves incumbent firms at the cost of the dynamism that drives long-run growth.'),
  h2('The Geopolitical Case'),
  p('Economic interdependence creates incentives for peaceful resolution of disputes. This is not naive idealism — it is rational-actor theory. Countries with deep trade relationships have more to lose from conflict than those that are economically isolated. The post-war international economic order, built on rules-based trade, produced the longest period of great-power peace in modern history.'),
  h2('Conclusion'),
  p('Free trade is not a perfect system. Its distributional consequences require active management, and its rules require enforcement. But the alternative — managed trade, industrial policy, and protectionism — has a worse track record. The solution to the problems of trade is more and better policy, not retreat from openness.'),
)

const freeTradeAgainstContent = doc(
  h2('The Limits of Free Trade Orthodoxy'),
  p('The textbook case for free trade is elegant. The real-world record is messier. The period of peak trade liberalisation — roughly 1990 to 2016 — generated substantial aggregate gains but also produced deindustrialisation, regional economic collapse, and the political backlash that has reshaped Western politics. The economics profession was slow to acknowledge the costs and is still catching up.'),
  p('Comparative advantage is a static concept. It describes the optimal allocation of existing resources, not the dynamic process by which countries develop new productive capacities. Countries that have grown rich — the United States, Germany, South Korea, China — did so not through free trade orthodoxy but through active industrial policy that built comparative advantages where none existed before.'),
  bq('"No country has ever become rich by following the advice it gives to developing nations."'),
  h2('The China Shock'),
  p('The work of Autor, Dorn, and Hanson on the "China Shock" fundamentally changed the empirical picture. Their finding — that Chinese import competition caused persistent, geographically concentrated job losses in US manufacturing that adjustment mechanisms failed to correct — demonstrated that the standard prediction of smooth reallocation was wrong. Workers who lost manufacturing jobs did not, in large numbers, find equivalent employment elsewhere.'),
  h2('Strategic Industries'),
  p('Free trade in widgets is one thing. Free trade in semiconductors, pharmaceuticals, and critical minerals is another. The pandemic demonstrated with brutal clarity the cost of supply chain concentration in strategically critical sectors. A country that has offshored the production of its own medicines cannot be said to have made a wise trade-off between efficiency and security, whatever the GDP figures suggest.'),
  h2('The Unequal Distribution of Gains'),
  p('Even if free trade increases aggregate welfare, it does so by creating winners and losers. The winners — consumers, export sectors, capital owners — are diffuse and politically weak. The losers — workers in import-competing industries, specific regions — are concentrated and politically powerful. This distributional dynamic has, predictably, generated political responses that are now unwinding the liberal order.'),
  h2('Conclusion'),
  p('The choice is not between free trade and autarky. It is between naive free trade orthodoxy and a more sophisticated approach that takes seriously the strategic, distributional, and dynamic dimensions that Ricardo\'s model ignores. Managed trade, with active industrial policy and strong domestic adjustment mechanisms, has a better real-world track record than its critics admit.'),
)

// ── Cover images (Unsplash, free to use) ────────────────────────────────────
const IMAGES = {
  // Workers in discussion — minimum wage / labour market
  minWage:   'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=1200&q=80',
  // AI chip / neural network — AI regulation
  aiReg:     'https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=1200&q=80',
  // Shipping containers at port — free trade / global commerce
  freeTrade: 'https://images.unsplash.com/photo-1578575437130-527eed3abbec?w=1200&q=80',
}

// ── Seed function ────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding debates…')

  // Fetch seed users
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
  const writer = await prisma.user.findFirst({ where: { role: { in: ['WRITER', 'EDITOR'] } } })

  if (!admin || !writer) {
    throw new Error('No admin or writer user found. Run the main seed first.')
  }

  const opinionCategory = await prisma.category.findFirst({
    where: { name: { contains: 'Opinion', mode: 'insensitive' } },
  })

  async function uniqueSlug(base: string): Promise<string> {
    let slug = base
    let i = 0
    while (await prisma.article.findUnique({ where: { slug } })) {
      i++
      slug = `${base}-${i}`
    }
    return slug
  }

  // ── Debate 1: Minimum Wage ─────────────────────────────────────────────────

  const mwForSlug = await uniqueSlug('raise-the-minimum-wage-the-economic-case')
  const mwAgainstSlug = await uniqueSlug('against-higher-minimum-wage-economic-analysis')

  const [mwForArticle, mwAgainstArticle] = await Promise.all([
    prisma.article.create({
      data: {
        title: 'Raise the Minimum Wage: The Economic Case',
        slug: mwForSlug,
        content: minWageForContent,
        excerpt: 'Decades of evidence show that carefully implemented minimum wage increases lift incomes without the job destruction critics predict. The monopsony argument is compelling, and the distributional case is stronger than ever.',
        authorId: admin.id,
        categoryId: opinionCategory?.id ?? null,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-03-10'),
        isDebate: true,
      },
    }),
    prisma.article.create({
      data: {
        title: 'Against a Higher Minimum Wage: The Economic Case',
        slug: mwAgainstSlug,
        content: minWageAgainstContent,
        excerpt: 'A higher minimum wage is not the most efficient tool for reducing poverty. Better-targeted instruments exist, and the employment costs — especially for vulnerable workers and small businesses — are higher than advocates admit.',
        authorId: writer.id,
        categoryId: opinionCategory?.id ?? null,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-03-10'),
        isDebate: true,
      },
    }),
  ])

  const debate1 = await prisma.debate.upsert({
    where: { id: 'seed-debate-minwage' },
    update: {},
    create: {
      id: 'seed-debate-minwage',
      title: 'Should the UK raise the minimum wage?',
      description: 'Two economists make the case for and against a significant increase in the National Living Wage.',
      forArticleId: mwForArticle.id,
      againstArticleId: mwAgainstArticle.id,
      isActive: false,
    },
  })

  // ── Debate 2: AI Regulation ────────────────────────────────────────────────

  const aiForSlug = await uniqueSlug('ai-regulation-economic-imperative')
  const aiAgainstSlug = await uniqueSlug('against-ai-regulation-innovation-cost')

  const [aiForArticle, aiAgainstArticle] = await Promise.all([
    prisma.article.create({
      data: {
        title: 'Regulating Artificial Intelligence: An Economic Imperative',
        slug: aiForSlug,
        content: aiRegForContent,
        excerpt: 'AI generates textbook market failures: negative externalities, information asymmetries, and competitive concentration. The economic case for regulation is strong, and the window for effective action is narrowing.',
        authorId: writer.id,
        categoryId: opinionCategory?.id ?? null,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-03-20'),
        isDebate: true,
      },
    }),
    prisma.article.create({
      data: {
        title: 'Against AI Regulation: The Innovation Cost We Cannot Afford',
        slug: aiAgainstSlug,
        content: aiRegAgainstContent,
        excerpt: 'Premature AI regulation will entrench incumbents, drive research offshore, and fail to address actual harms. Existing laws are sufficient; targeted enforcement is better than new frameworks.',
        authorId: admin.id,
        categoryId: opinionCategory?.id ?? null,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-03-20'),
        isDebate: true,
      },
    }),
  ])

  const debate2 = await prisma.debate.upsert({
    where: { id: 'seed-debate-aireg' },
    update: {},
    create: {
      id: 'seed-debate-aireg',
      title: 'Should AI be comprehensively regulated?',
      description: 'As AI transforms economies and labour markets, the question of how — and whether — to regulate it has never been more urgent.',
      forArticleId: aiForArticle.id,
      againstArticleId: aiAgainstArticle.id,
      isActive: true, // This is the active debate
    },
  })

  // Deactivate debate1 (just in case)
  await prisma.debate.update({ where: { id: debate1.id }, data: { isActive: false } })

  // ── Debate 3: Free Trade ───────────────────────────────────────────────────

  const ftForSlug = await uniqueSlug('in-defence-of-free-trade')
  const ftAgainstSlug = await uniqueSlug('limits-of-free-trade-orthodoxy')

  const [ftForArticle, ftAgainstArticle] = await Promise.all([
    prisma.article.create({
      data: {
        title: 'In Defence of Free Trade',
        slug: ftForSlug,
        content: freeTradeForContent,
        excerpt: 'The empirical case for free trade remains robust. Its distributional consequences require management — but the answer is redistribution policy, not protectionism.',
        authorId: admin.id,
        categoryId: opinionCategory?.id ?? null,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-02-15'),
        isDebate: true,
      },
    }),
    prisma.article.create({
      data: {
        title: 'The Limits of Free Trade Orthodoxy',
        slug: ftAgainstSlug,
        content: freeTradeAgainstContent,
        excerpt: 'The China Shock literature, the pandemic supply chain crisis, and the political backlash against liberalisation all point to the same conclusion: free trade orthodoxy is incomplete.',
        authorId: writer.id,
        categoryId: opinionCategory?.id ?? null,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-02-15'),
        isDebate: true,
      },
    }),
  ])

  const debate3 = await prisma.debate.upsert({
    where: { id: 'seed-debate-freetrade' },
    update: {},
    create: {
      id: 'seed-debate-freetrade',
      title: 'Does free trade do more harm than good?',
      description: 'The post-war free trade consensus is under unprecedented strain. Is the critique justified, or are the costs of retreat too high?',
      forArticleId: ftForArticle.id,
      againstArticleId: ftAgainstArticle.id,
      isActive: false,
    },
  })

  console.log('✓ Created 3 debates and 6 debate articles')

  // ── Seed votes ─────────────────────────────────────────────────────────────

  const debates = [
    { debate: debate1, forBias: 0.58, count: 240 }, // min wage: slight FOR lean
    { debate: debate2, forBias: 0.44, count: 380 }, // AI reg: slight AGAINST lean
    { debate: debate3, forBias: 0.51, count: 190 }, // free trade: roughly even
  ]

  for (const { debate, forBias, count } of debates) {
    // Check if already has votes
    const existingVotes = await prisma.debateVote.count({ where: { debateId: debate.id } })
    if (existingVotes > 0) {
      console.log(`  Debate "${debate.title}" already has ${existingVotes} votes — skipping`)
      continue
    }

    const voteData: { debateId: string; anonymousId: string; side: 'FOR' | 'AGAINST'; createdAt: Date }[] = []

    // Spread votes over the past 45 days
    const now = Date.now()
    const windowMs = 45 * 24 * 60 * 60 * 1000

    for (let i = 0; i < count; i++) {
      const side: 'FOR' | 'AGAINST' = Math.random() < forBias ? 'FOR' : 'AGAINST'
      const createdAt = new Date(now - Math.random() * windowMs)
      voteData.push({
        debateId: debate.id,
        anonymousId: randomUUID(),
        side,
        createdAt,
      })
    }

    await prisma.debateVote.createMany({ data: voteData })
    const forCount = voteData.filter((v) => v.side === 'FOR').length
    console.log(`  ✓ Seeded ${count} votes for "${debate.title}" (${forCount} FOR, ${count - forCount} AGAINST)`)
  }

  // ── Patch cover images on all debate articles (idempotent) ───────────────
  await Promise.all([
    prisma.article.update({ where: { id: debate1.forArticleId },      data: { coverImage: IMAGES.minWage   } }),
    prisma.article.update({ where: { id: debate1.againstArticleId },  data: { coverImage: IMAGES.minWage   } }),
    prisma.article.update({ where: { id: debate2.forArticleId },      data: { coverImage: IMAGES.aiReg     } }),
    prisma.article.update({ where: { id: debate2.againstArticleId },  data: { coverImage: IMAGES.aiReg     } }),
    prisma.article.update({ where: { id: debate3.forArticleId },      data: { coverImage: IMAGES.freeTrade } }),
    prisma.article.update({ where: { id: debate3.againstArticleId },  data: { coverImage: IMAGES.freeTrade } }),
  ])
  console.log('  ✓ Cover images set on all debate articles')

  console.log('✅ Debate seed complete')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
