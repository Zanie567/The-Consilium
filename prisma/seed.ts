import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env.local') })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! })
const prisma = new PrismaClient({ adapter })

// ─── Verified Unsplash images (HTTP 200 confirmed) ─────────────────────────
const IMAGES = {
  bankOfEngland:   'https://images.unsplash.com/photo-1725726009991-ae536f6fb8be?w=1200&q=80',
  canaryWharf:     'https://images.unsplash.com/photo-1561620777-41d73987913f?w=1200&q=80',
  aiChip:          'https://images.unsplash.com/photo-1716436329836-208bea5a55e6?w=1200&q=80',
  officeWorkers:   'https://images.unsplash.com/photo-1758762641372-e3b52bf061d4?w=1200&q=80',
  denseApartments: 'https://images.unsplash.com/photo-1767818375257-2d1f80c28c82?w=1200&q=80',
  viennaHousing:   'https://images.unsplash.com/photo-1578427947959-e656e97e02d4?w=1200&q=80',
  smokestacks:     'https://images.unsplash.com/photo-1760378105099-968c06b9b4bd?w=1200&q=80',
  windTurbines:    'https://images.unsplash.com/photo-1452179535021-368bb0edc3a8?w=1200&q=80',
}

// ─── Tiptap content builders ────────────────────────────────────────────────
type TiptapNode =
  | { type: 'doc'; content: TiptapNode[] }
  | { type: 'paragraph'; content: TiptapNode[] }
  | { type: 'text'; text: string; marks?: { type: string; attrs?: Record<string, unknown> }[] }
  | { type: 'heading'; attrs: { level: number }; content: TiptapNode[] }
  | { type: 'blockquote'; content: TiptapNode[] }
  | { type: 'image'; attrs: { src: string; alt: string } }
  | { type: 'horizontalRule' }
  | { type: 'orderedList'; content: TiptapNode[] }
  | { type: 'bulletList'; content: TiptapNode[] }
  | { type: 'listItem'; content: TiptapNode[] }

const p = (...texts: (string | TiptapNode)[]): TiptapNode => ({
  type: 'paragraph',
  content: texts.map((t) =>
    typeof t === 'string' ? { type: 'text', text: t } : t
  ),
})

const bold = (text: string): TiptapNode => ({
  type: 'text',
  text,
  marks: [{ type: 'bold' }],
})

const italic = (text: string): TiptapNode => ({
  type: 'text',
  text,
  marks: [{ type: 'italic' }],
})

const h2 = (text: string): TiptapNode => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [{ type: 'text', text }],
})

const h3 = (text: string): TiptapNode => ({
  type: 'heading',
  attrs: { level: 3 },
  content: [{ type: 'text', text }],
})

const quote = (text: string): TiptapNode => ({
  type: 'blockquote',
  content: [p(italic(text))],
})

const img = (src: string, alt: string): TiptapNode => ({
  type: 'image',
  attrs: { src, alt },
})

const caption = (text: string): TiptapNode => p(italic(text))

const hr = (): TiptapNode => ({ type: 'horizontalRule' })

const ol = (...items: string[]): TiptapNode => ({
  type: 'orderedList',
  content: items.map((item) => ({
    type: 'listItem',
    content: [p(item)],
  })),
})

const doc = (...nodes: TiptapNode[]): string =>
  JSON.stringify({ type: 'doc', content: nodes })


// ─── Article content ────────────────────────────────────────────────────────

const article1Content = doc(
  p(
    "The Bank of England's Monetary Policy Committee voted seven to two in February 2025 to cut the base rate from 4.75% to 4.5%, delivering the third consecutive reduction since the easing cycle began in August 2024. The decision reflected growing conviction among policymakers that inflation had returned durably to the 2% target after one of the most challenging inflationary episodes in four decades."
  ),
  h2('A Long-Awaited Pivot'),
  p(
    "For much of 2023 and 2024, the MPC resisted calls to loosen policy, keeping rates at a 16-year high of 5.25% as stubborn services inflation and strong wage growth complicated the picture. The pivot that many economists had anticipated arrived later than financial markets had initially priced, but it has gathered pace in recent months."
  ),
  p(
    "Headline CPI inflation fell to 2.5% in December 2024, broadly in line with the Bank's projections. Services inflation, which had proved the most persistent component of the inflationary episode, eased to around 4.4%. Both figures represent a substantial improvement from the peak of 11.1% reached in October 2022, when energy price shocks and global supply chain disruption combined to produce the worst inflationary environment in a generation."
  ),
  img(IMAGES.canaryWharf, 'London Canary Wharf financial district at dusk'),
  caption("London's Canary Wharf financial district. Photo: Simone Hutsch / Unsplash"),
  quote(
    '"The stance of monetary policy remains restrictive even after today\'s decision, and the Committee will continue to assess whether further adjustments are appropriate as the economic outlook evolves." (MPC Statement, February 2025)'
  ),
  h2('Services Inflation: The Final Hurdle'),
  p(
    "Despite the overall improvement, the MPC has signalled continuing caution about the services sector. Services inflation remains well above levels consistent with the 2% target, reflecting the lagged effects of the tight labour market that characterised 2023. The unemployment rate, while rising modestly to around 4.4%, remains historically low, and nominal wage growth of roughly 5.5% continues to feed into the prices of labour-intensive services."
  ),
  p(
    "Two MPC members, Swati Dhingra and one other external member, voted for a larger 50 basis point cut, arguing that the risks had shifted decisively towards a sharper-than-expected slowdown in economic activity. The majority judged that a more gradual approach remained appropriate given the residual uncertainty."
  ),
  h2('What Markets Expect'),
  p(
    "Interest rate futures markets price in two or three further 25 basis point reductions by the end of 2025, which would bring Bank Rate to around 3.75% to 4%. That compares to the six cuts that were anticipated at the start of 2024, before the stickiness of domestic inflationary pressures became apparent."
  ),
  p(
    "Governor Andrew Bailey has emphasised repeatedly that the MPC will not commit to a predetermined path and will remain data-dependent at each meeting. The next decision is scheduled for May 2025, when updated forecasts from the Monetary Policy Report will inform the Committee's judgement."
  ),
  hr(),
  h3('Sources'),
  ol(
    'Bank of England, "Monetary Policy Summary and minutes of the Monetary Policy Committee meeting ending 5 February 2025." bankofengland.co.uk, February 2025.',
    'Office for National Statistics, "Consumer price inflation, UK: December 2024." ons.gov.uk, January 2025.',
    'Office for National Statistics, "Labour market overview, UK: January 2025." ons.gov.uk, January 2025.',
    'HM Treasury, "Forecasts for the UK Economy: February 2025." gov.uk, February 2025.',
  )
)

const article2Content = doc(
  p(
    "The question of whether artificial intelligence will primarily destroy jobs or create new ones has become one of the defining economic debates of the decade. The answer, as with most genuinely important questions in economics, is deeply uncertain and depends critically on the pace of technological change, the adaptability of workers, and the institutional environment in which these transitions play out."
  ),
  h2('Historical Analogies and Their Limits'),
  p(
    "Optimists frequently invoke the agricultural and industrial revolutions as evidence that technological disruption ultimately generates more employment than it destroys. The mechanisation of farming displaced millions of agricultural workers over the course of a century, yet living standards rose dramatically and new industries absorbed the displaced workers, albeit after periods of significant hardship and social dislocation."
  ),
  p(
    "The key difference this time, pessimists argue, is that AI threatens cognitive labour in a way that previous technologies did not. Agricultural mechanisation replaced muscle power; the assembly line replaced routine manual dexterity. But if AI can replicate complex reasoning, analysis, and even creative work, the range of tasks susceptible to automation expands far beyond anything seen in previous technological revolutions."
  ),
  img(IMAGES.officeWorkers, 'Workers collaborating at computers in a modern open-plan office'),
  caption('Knowledge workers in a modern office environment. Photo: tommao wang / Unsplash'),
  quote(
    '"The worry is not that machines will replace all human labour, but that the transition will be faster than institutions can adapt, leaving millions of workers stranded between the jobs that have disappeared and the jobs that have not yet been created." (Daron Acemoglu, MIT, 2024)'
  ),
  h2('What the Evidence Actually Shows'),
  p(
    "Recent empirical work has complicated both the optimistic and pessimistic narratives. A 2024 study by Acemoglu and Restrepo found that AI adoption has so far been concentrated in a narrow set of tasks and sectors, with limited aggregate employment effects. However, the same study noted that the pace of adoption has been accelerating rapidly, and that historical patterns may not be a reliable guide to the current transition."
  ),
  p(
    "A separate analysis from the McKinsey Global Institute estimated that between 75 million and 375 million workers globally, roughly 3% to 14% of the global workforce, may need to change occupational category by 2030 due to automation. The enormous range of that estimate captures how uncertain the projection genuinely is, and how sensitive it is to assumptions about adoption rates and policy responses."
  ),
  h2('The Policy Question'),
  p(
    "If the pessimists are even partially right, the policy response matters enormously. The historical record suggests that technological transitions produce better outcomes when active labour market policies, retraining programmes, and social insurance systems are strong enough to support workers through the adjustment. Countries with more developed welfare states and more responsive education systems have generally managed previous technological transitions with less inequality and less political disruption."
  ),
  p(
    "For the UK in particular, the challenge is acute. Decades of underinvestment in further education and adult retraining mean that the institutional capacity to manage a rapid technological transition is weaker than in many comparable economies. The question is not whether AI will change the labour market. It will. The question is whether policymakers act early enough to shape the transition."
  ),
  hr(),
  h3('Sources'),
  ol(
    'Acemoglu, D. and Restrepo, P., "Tasks, Automation, and the Rise in US Wage Inequality." Econometrica, 2022.',
    'McKinsey Global Institute, "Jobs Lost, Jobs Gained: Workforce Transitions in a Time of Automation." mckinsey.com, 2023.',
    'Autor, D., "Work of the Past, Work of the Future." AEA Papers and Proceedings, 2019.',
    'OECD, "OECD Employment Outlook 2024: The Net-Zero Transition and the Labour Market." oecd.org, 2024.',
    'Goldman Sachs Global Investment Research, "The Potentially Large Effects of Artificial Intelligence on Economic Growth." March 2023.',
  )
)

const article3Content = doc(
  p(
    "House prices across most advanced economies have risen dramatically relative to incomes over the past three decades. The ratio of median house prices to median household income has roughly doubled in many OECD countries since the 1990s, with particularly sharp deterioration in cities that have become hubs of knowledge-economy employment. In London, Sydney, and Vancouver, median homes now cost more than ten times median household incomes, a threshold once considered a marker of extreme unaffordability."
  ),
  h2('Causes of the Crisis'),
  p(
    "The causes are contested but the broad outlines are clear. Restrictive planning regimes have constrained supply in areas of high demand. Low interest rates across the 2010s inflated asset prices broadly, including housing. Growing household incomes among high earners have bid up prices in desirable locations. And demographic trends, including declining household sizes, have increased demand for housing units independently of overall population growth."
  ),
  p(
    "What makes the housing crisis particularly difficult to resolve is that it involves a collision between two legitimate interests. Existing homeowners benefit financially from rising prices and often resist new development near their homes. Younger renters and aspiring buyers are the losers, but they are less likely to vote and less organised politically. The result, in many democracies, is a systematic bias against the supply-side interventions needed to restore affordability."
  ),
  img(IMAGES.viennaHousing, 'Social housing architecture in Vienna, Austria'),
  caption('Vienna\'s social housing programme, one of the most ambitious in the world, keeps rents affordable for roughly 60% of the city\'s residents. Photo: Arno Senoner / Unsplash'),
  h2('International Approaches: Vienna and Singapore'),
  p(
    "The contrast with Vienna is instructive. The Austrian capital has maintained a large-scale social housing programme since the 1920s, with the city government owning or subsidising roughly 60% of all housing. Rents in social housing are set well below market rates, and eligibility extends to a wide range of income levels rather than being targeted narrowly at the very poor. The result is a city where median rents consume a much smaller share of household income than in comparable European capitals."
  ),
  p(
    "Singapore offers a different model. The city-state's Housing Development Board constructs and manages public housing that accommodates around 80% of the population, with residents able to purchase their flats on long leases. The programme has been instrumental in building a property-owning middle class while keeping housing broadly affordable, though critics note that the model depends on land ownership conditions and state capacity that are difficult to replicate elsewhere."
  ),
  h2('Lessons for the UK'),
  p(
    "The UK's housing crisis is rooted in decades of underbuilding. Successive governments have set ambitious housebuilding targets and consistently missed them, constrained by a planning system that gives significant weight to local objections and limited incentives for local authorities to approve new development. The Labour government elected in 2024 has proposed planning reforms designed to unlock more sites for development, but the political economy of housing reform remains treacherous."
  ),
  p(
    "International experience suggests that no single policy lever is sufficient. Sustained improvements in affordability require expanding supply through planning reform, investing in social and affordable housing, and addressing the tax treatment of housing wealth, which currently provides very large subsidies to owner-occupiers at the expense of renters and younger generations. The economic case for reform is strong. The political case is harder to make, but no less urgent."
  ),
  hr(),
  h3('Sources'),
  ol(
    'OECD, "Affordable Housing Database." oecd.org, 2024.',
    'Demographia, "International Housing Affordability Survey: 2024 Edition." demographia.com, 2024.',
    'Shelter, "A Vision for Social Housing." shelter.org.uk, 2023.',
    'City of Vienna, "Wiener Wohnen: Annual Report 2023." wien.gv.at, 2024.',
    'Housing Development Board Singapore, "HDB Annual Report 2023/24." hdb.gov.sg, 2024.',
    'Resolution Foundation, "The state of the nation\'s housing 2024." resolutionfoundation.org, 2024.',
  )
)

const article4Content = doc(
  p(
    "Carbon pricing has been described by economists almost unanimously as the most cost-effective tool for reducing greenhouse gas emissions. By putting a price on the right to emit carbon dioxide, governments can harness market forces to find the cheapest ways of cutting emissions across the whole economy, rather than relying on regulators to identify individual abatement opportunities. The theory is sound. The practice has proved far more complicated."
  ),
  h2('A Patchwork of Schemes'),
  p(
    "As of 2025, roughly 25% of global greenhouse gas emissions are covered by some form of explicit carbon price, whether through emissions trading schemes or carbon taxes. This represents a significant increase from a decade ago, but it also means that three quarters of global emissions remain unpriced. More troublingly, the prices in existing schemes vary enormously, from less than one US dollar per tonne of CO2 in some developing-economy programmes to above seventy dollars per tonne in the EU's Emissions Trading System."
  ),
  p(
    "This fragmentation creates several problems. First, it means that emissions are not being reduced where it would be cheapest to do so. Second, it creates competitive pressures that push carbon-intensive production towards jurisdictions with weaker pricing. Third, it complicates the construction of international agreements, since countries with strong carbon prices resist being disadvantaged relative to competitors who have not internalised the social cost of carbon."
  ),
  img(IMAGES.windTurbines, 'Offshore wind turbines at sea representing renewable energy transition'),
  caption('The transition to renewable energy is central to climate policy, but requires coordinated carbon pricing to accelerate investment at scale. Photo: Thomas Richter / Unsplash'),
  quote(
    '"A fragmented carbon market is better than no carbon market, but it is not nearly sufficient to drive the investment in clean energy at the speed and scale that the climate challenge demands." (IEA World Energy Outlook, 2024)'
  ),
  h2('The EU Carbon Border Adjustment Mechanism'),
  p(
    "The European Union's Carbon Border Adjustment Mechanism, which began its transitional phase in 2023 and will be fully operational from 2026, represents an attempt to address the competitive distortion problem. By requiring importers of certain carbon-intensive goods to purchase carbon certificates equivalent to the price that would have been paid under the EU ETS, the CBAM aims to level the playing field between European producers who face a carbon price and foreign competitors who do not."
  ),
  p(
    "The mechanism has attracted both praise and criticism. Proponents argue that it creates incentives for trading partners to adopt their own carbon pricing rather than face border charges, potentially triggering a race to the top rather than a race to the bottom on climate ambition. Critics, particularly in developing economies, argue that it is a form of protectionism that disadvantages countries that lack the institutional and fiscal capacity to implement comparable carbon pricing."
  ),
  h2('Towards a More Coherent Architecture'),
  p(
    "A growing body of academic and policy work advocates for a minimum global carbon price floor, coordinated among major emitters, as a way of addressing fragmentation without requiring full harmonisation. The International Monetary Fund has modelled a floor of around 75 dollars per tonne for high-income countries by 2030, with lower floors for emerging and developing economies. Under this scenario, modelling suggests that roughly 23% of the emissions reductions needed to stay consistent with 2 degrees Celsius of warming could be achieved at a fraction of the cost of current policies."
  ),
  p(
    "Whether such coordination is politically achievable is a separate question. The history of international climate negotiations suggests that ambition and political will do not always move in the same direction. But as the physical costs of climate change become more apparent and the economics of clean energy continue to improve, the case for more coherent carbon pricing architecture grows stronger with each passing year."
  ),
  hr(),
  h3('Sources'),
  ol(
    'World Bank, "State and Trends of Carbon Pricing 2024." worldbank.org, 2024.',
    'International Energy Agency, "World Energy Outlook 2024." iea.org, 2024.',
    'International Monetary Fund, "Fiscal Monitor: A Fair Shot." imf.org, October 2024.',
    'European Commission, "Carbon Border Adjustment Mechanism: Questions and Answers." ec.europa.eu, 2023.',
    'Stiglitz, J. and Stern, N., "Report of the High-Level Commission on Carbon Prices." carbonpricingleadership.org, 2017.',
  )
)


// ─── Main seed function ─────────────────────────────────────────────────────

async function main() {
  console.log('Seeding database...')

  const categories = await Promise.all([
    prisma.category.upsert({
      where: { slug: 'news' },
      update: {},
      create: { name: 'News', slug: 'news' },
    }),
    prisma.category.upsert({
      where: { slug: 'opinion' },
      update: {},
      create: { name: 'Opinion', slug: 'opinion' },
    }),
    prisma.category.upsert({
      where: { slug: 'analysis' },
      update: {},
      create: { name: 'Analysis', slug: 'analysis' },
    }),
    prisma.category.upsert({
      where: { slug: 'interviews' },
      update: {},
      create: { name: 'Interviews', slug: 'interviews' },
    }),
  ])

  console.log('Categories:', categories.map((c: { name: string }) => c.name).join(', '))

  const adminPassword = await bcrypt.hash('consilium2024', 10)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@theconsilium.com' },
    update: { password: adminPassword },
    create: {
      name: 'The Consilium Admin',
      email: 'admin@theconsilium.com',
      password: adminPassword,
      role: 'ADMIN',
      bio: 'Editor-in-Chief of The Consilium.',
    },
  })

  const writerPassword = await bcrypt.hash('writer2024', 10)
  const writer = await prisma.user.upsert({
    where: { email: 'writer@theconsilium.com' },
    update: {},
    create: {
      name: 'Eleanor Hughes',
      email: 'writer@theconsilium.com',
      password: writerPassword,
      role: 'WRITER',
      bio: 'Eleanor Hughes is a third-year Economics student at the University of Edinburgh, specialising in macroeconomic policy and international finance.',
    },
  })

  console.log('Users:', admin.email, writer.email)

  const [newsCategory, opinionCategory, analysisCategory] = categories

  const article1 = await prisma.article.upsert({
    where: { slug: 'bank-of-england-cuts-rates-february-2025' },
    update: {
      title: 'Bank of England Cuts Rates to 4.5% as Inflation Returns to Target',
      content: article1Content,
      coverImage: IMAGES.bankOfEngland,
      excerpt: 'The MPC votes 7-2 to cut Bank Rate for the third consecutive time, bringing it to 4.5% and signalling a cautious but sustained path towards looser monetary policy.',
      publishedAt: new Date('2025-02-06'),
    },
    create: {
      title: 'Bank of England Cuts Rates to 4.5% as Inflation Returns to Target',
      slug: 'bank-of-england-cuts-rates-february-2025',
      content: article1Content,
      coverImage: IMAGES.bankOfEngland,
      excerpt: 'The MPC votes 7-2 to cut Bank Rate for the third consecutive time, bringing it to 4.5% and signalling a cautious but sustained path towards looser monetary policy.',
      categoryId: newsCategory.id,
      authorId: writer.id,
      status: 'PUBLISHED',
      publishedAt: new Date('2025-02-06'),
    },
  })

  // Remove old article slug if it exists
  await prisma.article.deleteMany({
    where: { slug: 'bank-of-england-holds-rates-as-inflation-retreats' },
  })

  const article2 = await prisma.article.upsert({
    where: { slug: 'ai-and-labour-markets-beyond-the-technopanic' },
    update: {
      content: article2Content,
      coverImage: IMAGES.aiChip,
      excerpt: 'The debate about artificial intelligence and employment is too important to be left to either starry-eyed optimists or catastrophists. A sober assessment of the evidence is overdue.',
    },
    create: {
      title: 'AI and Labour Markets: Beyond the Technopanic',
      slug: 'ai-and-labour-markets-beyond-the-technopanic',
      content: article2Content,
      coverImage: IMAGES.aiChip,
      excerpt: 'The debate about artificial intelligence and employment is too important to be left to either starry-eyed optimists or catastrophists. A sober assessment of the evidence is overdue.',
      categoryId: opinionCategory.id,
      authorId: writer.id,
      status: 'PUBLISHED',
      publishedAt: new Date('2025-01-20'),
    },
  })

  const article3 = await prisma.article.upsert({
    where: { slug: 'housing-affordability-crisis-policy-responses' },
    update: {
      content: article3Content,
      coverImage: IMAGES.denseApartments,
      excerpt: "From Vienna's social housing model to Singapore's HDB scheme, different countries have taken strikingly different approaches to housing affordability. What can Britain learn from international experience?",
    },
    create: {
      title: 'The Housing Affordability Crisis: Comparing Policy Responses Across the OECD',
      slug: 'housing-affordability-crisis-policy-responses',
      content: article3Content,
      coverImage: IMAGES.denseApartments,
      excerpt: "From Vienna's social housing model to Singapore's HDB scheme, different countries have taken strikingly different approaches to housing affordability. What can Britain learn from international experience?",
      categoryId: analysisCategory.id,
      authorId: admin.id,
      status: 'PUBLISHED',
      publishedAt: new Date('2025-01-10'),
    },
  })

  const article4 = await prisma.article.upsert({
    where: { slug: 'carbon-markets-fragmentation-climate-policy' },
    update: {
      title: 'Carbon Market Fragmentation and the Challenge of Global Climate Coordination',
      content: article4Content,
      coverImage: IMAGES.smokestacks,
      excerpt: 'An examination of the growing patchwork of carbon pricing mechanisms and their implications for climate ambition.',
      status: 'PUBLISHED',
      publishedAt: new Date('2025-02-15'),
    },
    create: {
      title: 'Carbon Market Fragmentation and the Challenge of Global Climate Coordination',
      slug: 'carbon-markets-fragmentation-climate-policy',
      content: article4Content,
      coverImage: IMAGES.smokestacks,
      excerpt: 'An examination of the growing patchwork of carbon pricing mechanisms and their implications for climate ambition.',
      categoryId: analysisCategory.id,
      authorId: writer.id,
      status: 'PUBLISHED',
      publishedAt: new Date('2025-02-15'),
    },
  })

  console.log('Articles:', [article1, article2, article3, article4].map((a: { title: string }) => a.title).join('\n  '))

  // ── Team members ───────────────────────────────────────────────────────────
  const teamData = [
    {
      name: 'Alexander Escala',
      role: 'Editor-in-Chief',
      image: '/team/alexander-escala.png',
      bio: 'Economics student at the University of Edinburgh with a focus on development economics and structural transformation.',
      order: 1,
    },
    {
      name: 'Annika Sarawgi',
      role: 'Senior Editor',
      image: '/team/annika-sarawgi.png',
      bio: 'Senior Editor at The Consilium, coordinating editorial strategy and content development.',
      order: 2,
    },
    {
      name: 'Sam Hunt',
      role: 'Junior Editor',
      image: '/team/sam-hunt.png',
      bio: 'Junior Editor supporting content creation and editorial processes.',
      order: 3,
    },
    {
      name: 'Zara Spendiff',
      role: 'Writer',
      image: '/team/zara-spendiff.png',
      bio: 'Writer covering economics, policy, and current affairs.',
      order: 4,
    },
    {
      name: 'Gurmehar Kaur',
      role: 'Writer',
      image: '/team/gurmehar-kaur.png',
      bio: 'Writer contributing analysis and commentary on economic issues.',
      order: 5,
    },
    {
      name: 'Yaoqing Wang',
      role: 'Writer',
      bio: 'Writer exploring economic policy and international affairs.',
      order: 6,
    },
    {
      name: 'Catherine Toh',
      role: 'Writer',
      image: '/team/catherine-toh.png',
      bio: 'Writer focusing on economic analysis and commentary.',
      order: 7,
    },
  ]

  await prisma.teamMember.deleteMany({})
  for (const member of teamData) {
    await prisma.teamMember.create({ data: member })
  }

  console.log('Team:', teamData.map((m) => m.name).join(', '))
  console.log('\nSeeding complete.')
  console.log('\nAdmin: admin@theconsilium.com / consilium2024')
  console.log('Writer: writer@theconsilium.com / writer2024')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
