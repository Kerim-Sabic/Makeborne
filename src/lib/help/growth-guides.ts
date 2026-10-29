import type { HelpArticle } from "./articles";

/**
 * "Grow your business" guides: the questions freelancers and studios actually
 * search for, answered practically, with the Makeborne feature that does the
 * work. Advice is general; claims about Makeborne must stay true to what ships.
 */
const UPDATED = "2026-10-14";

export const GROWTH_GUIDES: HelpArticle[] = [
  {
    slug: "get-clients-as-a-freelance-web-designer", category: "grow", updated: UPDATED, demo: "find-leads",
    title: "How to get clients as a freelance web designer",
    description: "A repeatable way to win web design clients: pick a niche, find businesses that need you, send a personal email, follow up and show the work.",
    keywords: ["get clients", "find clients", "freelance web designer", "web design clients", "more clients", "client acquisition", "freelance", "agency clients"],
    answer: "Pick one niche you can speak to, find 25 businesses in it whose websites are holding them back, and send each a short, specific email about one thing you would improve. Follow up twice over two weeks, then share a quick mock-up with anyone who replies. In Makeborne, use map or list lead finding, personal emails, manual CRM follow-up dates and review links. Automated sequence sending is disabled for launch; Gmail is currently send-only.",
    steps: [
      { name: "Choose a niche", text: "Dentists, restaurants, yoga studios: one group whose customers and problems you understand. Your emails get sharper and your portfolio more convincing." },
      { name: "Find 25 good leads", text: "Use Find leads with your niche and city. Look for businesses with an outdated site, no online booking or no clear call to action." },
      { name: "Write one specific email each", text: "Mention something real about their business and one improvement. Write personal emails drafts these from each lead’s public page for you to edit." },
      { name: "Follow up twice", text: "Set manual follow-up dates and check your inbox before sending another message. Automated sequence sending is disabled for launch." },
      { name: "Show, don’t tell", text: "When someone is interested, make a quick draft of their new homepage and send a review link they can comment on." },
    ],
    sections: [
      { heading: "What makes outreach work", list: ["Specific beats clever: one real observation about their business.", "Small asks: “Would a 2-minute mock-up help?” gets more replies than “Can we book a call?”.", "Consistency: 25 thoughtful emails a week beats 500 generic ones."] },
    ],
    faqs: [
      { q: "How many leads should I contact per week?", a: "Start with 20–30 well-researched leads. Quality and follow-up matter more than volume, and new mailboxes need time to warm up." },
      { q: "Should I offer free work?", a: "A small, quick mock-up of one page is a strong opener. Avoid full free projects." },
    ],
    related: ["find-new-leads", "write-a-cold-email-that-gets-replies", "follow-up-with-clients-without-being-pushy"],
  },
  {
    slug: "write-a-cold-email-that-gets-replies", category: "grow", updated: UPDATED, demo: "personal-emails",
    title: "How to write a cold email that gets replies",
    description: "The structure of a short, personal cold email that people answer, with an example and the mistakes that get emails ignored.",
    keywords: ["cold email", "outreach email", "email template", "sales email", "prospecting email", "get replies", "first email", "email example"],
    answer: "Keep it under 120 words: one line that proves you looked at their business, one specific problem or opportunity, one sentence on how you would help, and one easy question. Use their name, skip the long introduction about yourself, and never attach files to a first email. Personal beats polished.",
    steps: [
      { name: "Open with something real", text: "A detail only they would recognise: a recent post, their new location, a review customers keep mentioning." },
      { name: "Name one opportunity", text: "For example: “Your menu is a PDF, so it’s hard to read on phones.”" },
      { name: "Say how you’d help, briefly", text: "One sentence, ideally with a result you have achieved for a similar business." },
      { name: "Ask a small question", text: "“Want me to sketch how it could look?” is easier to answer than a meeting request." },
      { name: "Sign off like a person", text: "Your first name and one line about who you are." },
    ],
    sections: [
      { heading: "Example", paragraphs: ["“Hi Amra, your seasonal lunch photos are lovely. Right now the menu is a PDF, so on phones it’s tiny and slow to open. I build fast, simple restaurant sites ([your real result for a similar place]). Want me to sketch how your menu could look on a phone? — Lena”"] },
      { heading: "Avoid", list: ["Generic flattery (“I love your brand!”).", "Paragraphs about yourself.", "Links and attachments in the first email.", "Invented facts. If you are not sure, leave it out."] },
    ],
    faqs: [
      { q: "Can AI write these for me?", a: "Write personal emails reads each lead’s public page and drafts a different email per person. Review and edit every one before sending." },
      { q: "What subject line works?", a: "Short and specific, like “Quick idea for your lunch menu”. Avoid clickbait." },
    ],
    related: ["send-personal-outreach-emails", "get-clients-as-a-freelance-web-designer", "follow-up-with-clients-without-being-pushy"],
  },
  {
    slug: "find-instagram-influencers-in-your-niche", category: "grow", updated: UPDATED, demo: "find-leads",
    title: "How to find Instagram influencers in your niche",
    description: "Plan relevant creator outreach and read profiles from your own list. Discovery by niche and More like this are temporarily unavailable.",
    keywords: ["find influencers", "instagram influencers", "micro influencers", "creators in my niche", "tiktok creators", "youtubers", "influencer outreach", "find creators"],
    answer: "Creator discovery by niche and More like this are temporarily unavailable while search spending limits are verified. Find relevant Instagram, TikTok or YouTube profiles on the platform, then paste their links into Find leads → From your list. Makeborne reads the profiles, checks contact routes and ranks them for your offer. Discovery by niche remains on the roadmap.",
    steps: [
      { name: "Describe the niche precisely", text: "Use a precise niche when searching directly on the platform, such as easy vegan dinners for families." },
      { name: "Choose an audience size", text: "Review audience size on the platform and collect the profile links that fit." },
      { name: "Read your list and review", text: "Paste the profile links into From your list. Verified results are ranked for your offer." },
      { name: "Check the contact route", text: "Business emails from bios and link-in-bio pages are shown; otherwise reach out by DM." },
      { name: "Find more relevant profiles", text: "Search directly on the platform and paste another list. More like this is temporarily unavailable." },
    ],
    sections: [
      { heading: "Current availability", paragraphs: ["Creator discovery by niche and More like this are temporarily unavailable. Map searches and reading your own list remain available; discovery remains on the roadmap after search spending limits are verified."] },
      { heading: "Signs of a good partner", list: ["Recent, consistent posts in your niche.", "Comments from real people, not just emojis.", "A clear way to contact them for business."] },
    ],
    faqs: [
      { q: "Do you show TikTok and YouTube follower counts?", a: "Those platforms hide counts from automated readers, so they may be missing. Profiles are still confirmed as real." },
      { q: "Is it okay to email creators?", a: "Use the business contact they publish, keep it personal and relevant, and stop if they ask." },
    ],
    related: ["find-new-leads", "write-a-cold-email-that-gets-replies"],
  },
  {
    slug: "create-a-lead-magnet-ebook", category: "grow", updated: UPDATED, demo: "make-book",
    title: "How to create a lead magnet e-book that people download",
    description: "Plan a short, useful e-book your ideal clients want, write it from your notes with AI, and export a polished PDF to offer on your website.",
    keywords: ["lead magnet", "ebook", "free guide", "email list", "opt-in", "download", "checklist", "content marketing", "lead magnet ebook", "freebie"],
    answer: "Solve one specific problem your ideal client has right now, in 10–20 pages. Give it a clear promise as the title (“The first-year café checklist”), attach your notes, and let Makeborne plan the chapters for you to approve before it writes and typesets the book. Export the PDF and offer it on your website in exchange for an email address.",
    steps: [
      { name: "Pick one painful problem", text: "Narrow beats broad: “Price your first wedding package” rather than “Wedding business guide”." },
      { name: "Write the promise as the title", text: "Say what the reader will be able to do after reading." },
      { name: "Attach your notes", text: "Your experience is what makes it worth downloading." },
      { name: "Plan, then create", text: "Approve the chapter plan, then let it write and lay out the book." },
      { name: "Export and offer it", text: "Download the PDF and add it to your site with a short sign-up form." },
    ],
    faqs: [
      { q: "How long should a lead magnet be?", a: "Long enough to solve the problem and no longer. Often 10–20 pages or a checklist." },
      { q: "Can I edit the text after it’s written?", a: "Yes. Ask for changes to any chapter until it sounds like you." },
    ],
    related: ["make-a-book-with-ai", "attach-files-to-your-brief"],
  },
  {
    slug: "make-a-pitch-deck-with-ai", category: "grow", updated: UPDATED, demo: "presentation",
    title: "How to make a pitch deck with AI",
    description: "The 10 slides most pitch decks need, what goes on each, and how to turn your notes into a designed deck you can edit in PowerPoint.",
    keywords: ["pitch deck", "investor deck", "startup pitch", "sales deck", "pitch presentation", "slides for investors", "proposal deck", "pitch deck for investors", "investors", "fundraising", "raise money"],
    answer: "Most pitch decks need about ten slides: problem, solution, why now, market, product, traction, business model, competition, team and the ask. Write two or three real points for each, paste them into a new Presentation with your numbers, and Makeborne designs the slides with speaker notes. Adjust any slide by asking, then export an editable PowerPoint file.",
    steps: [
      { name: "Outline ten slides", text: "Problem, solution, why now, market, product, traction, model, competition, team, ask." },
      { name: "Add real numbers", text: "Revenue, users, growth, prices. Never let AI invent figures." },
      { name: "Create the deck", text: "Paste your outline into a new Presentation." },
      { name: "Refine slide by slide", text: "Ask for changes such as “turn traction into a chart”." },
      { name: "Export", text: "Download a PDF to send, or PowerPoint to keep editing." },
    ],
    faqs: [
      { q: "How long should a pitch deck be?", a: "Ten to fifteen slides for a meeting; a shorter version for email." },
      { q: "Can I present from PowerPoint?", a: "Yes. The PowerPoint export is editable, with native charts where supported." },
    ],
    related: ["make-a-presentation-with-ai", "write-a-great-brief"],
  },
  {
    slug: "build-a-website-for-a-local-business", category: "grow", updated: UPDATED, demo: "create-website",
    title: "How to build a website for a local business",
    description: "What a local business website needs (hours, location, booking, reviews, mobile speed) and how to build and publish one in an afternoon.",
    keywords: ["local business website", "small business website", "restaurant website", "salon website", "clinic website", "website for my shop", "local seo", "website for my salon", "website for my restaurant", "salon", "restaurant", "dentist", "local", "my shop"],
    answer: "A local business site has one job: turn a visitor into a booking, call or visit. Put opening hours, location and the main action (book, order, call) at the top, then services with prices, real reviews and photos. Describe all of that in one brief, create it in Makeborne, check it on your phone, and publish it to a web address you can share.",
    steps: [
      { name: "Gather the essentials", text: "Name, address, hours, phone, services and prices, three real reviews, and your best photos." },
      { name: "Decide the main action", text: "Book online, order, call or visit. Put it in the brief." },
      { name: "Create the site", text: "Choose Website and paste your brief." },
      { name: "Check it on a phone", text: "Most local visitors arrive on mobile. Ask for any changes in plain words." },
      { name: "Publish and share", text: "Publish, then add the link to your Google Business Profile and social pages." },
    ],
    sections: [{ heading: "Must-haves", list: ["Hours and address near the top.", "A big, obvious button for the main action.", "Real reviews, with permission.", "Fast loading on phones."] }],
    faqs: [{ q: "Do I need a domain?", a: "Each site gets a Makeborne web address you can share straight away." }],
    related: ["create-a-website-with-ai", "publish-your-website", "write-a-great-brief"],
  },
  {
    slug: "follow-up-with-clients-without-being-pushy", category: "grow", updated: UPDATED, demo: "connect-email",
    title: "How to follow up with clients without being pushy",
    description: "When to follow up and what to say each time. Use manual CRM reminders while automated sequence sending is disabled for the current launch.",
    keywords: ["follow up", "follow-up email", "no reply", "chase client", "polite reminder", "sales follow up", "email sequence", "drip", "not replying", "no response", "ghosted", "didn't reply", "hasn't replied"],
    answer: "Follow up two or three times, a few days apart, and make every message add something new: an example, a useful tip, or a simple yes-or-no question. End with a friendly last note that says you will stop. In Makeborne, set CRM follow-up dates and send reviewed messages manually. Automated sequence sending is disabled for launch. Gmail is send-only, so check replies in Gmail before each follow-up.",
    steps: [
      { name: "Day 3: add an example", text: "Share a short before-and-after or a result for a similar client." },
      { name: "Day 7: give a useful tip", text: "Something they can do themselves, with no strings attached." },
      { name: "Day 14: close the loop", text: "“I’ll stop here. If it becomes a priority, just reply.”" },
      { name: "Set a reminder", text: "Set a CRM follow-up date, check your inbox and send manually. Automated sequence sending is disabled for launch." },
    ],
    faqs: [
      { q: "How many follow-ups are too many?", a: "Two or three after the first email is plenty for cold outreach." },
      { q: "What if they reply “not now”?", a: "Thank them, set a follow-up date months ahead in the CRM, and move on." },
    ],
    related: ["connect-gmail-or-outlook", "write-a-cold-email-that-gets-replies", "manage-clients-and-follow-ups"],
  },
  {
    slug: "get-client-approval-on-designs", category: "grow", updated: UPDATED, demo: "review-link",
    title: "How to get client approval on designs faster",
    description: "Cut revision rounds with one review link, clear questions, comments in one place and a recorded approval for each version.",
    keywords: ["client approval", "design feedback", "revisions", "sign off", "client review", "proofing", "feedback loop"],
    answer: "Send one link to the exact version you want reviewed, ask two or three specific questions, and keep every comment in one place. With Makeborne review links, clients comment and approve without an account, the approval is recorded against the version number, and the project is marked Delivered, so there is no doubt about what was signed off.",
    steps: [
      { name: "Share the right version", text: "Choose the latest version or pin a specific one." },
      { name: "Ask specific questions", text: "“Is the menu order right?” gets better feedback than “Thoughts?”." },
      { name: "Collect feedback in one place", text: "Comments arrive on the project; resolve them as you make changes." },
      { name: "Get a clear approval", text: "The client approves or requests changes, recorded with the version number." },
    ],
    faqs: [{ q: "Does the client need an account?", a: "No. Anyone with the link can view, comment and approve." }],
    related: ["share-work-for-client-review", "manage-clients-and-follow-ups"],
  },
  {
    slug: "price-a-website-project", category: "grow", updated: UPDATED, demo: "advisors",
    title: "How to price a website project",
    description: "Price websites by the value they create, not by the page: three packages, what goes in each, and how to present the price.",
    keywords: ["website pricing", "how much to charge", "price a website", "web design rates", "packages", "quote", "proposal pricing", "how much should i charge", "charge for a website", "charge", "rates"],
    answer: "Price the outcome, not the hours. Work out what one extra booking, order or lead is worth to the client, then offer three packages, such as essentials, growth and full service, with the middle one as the obvious choice. Show what each includes and a clear timeline, and take a deposit to start. Juno, the pricing advisor, can pressure-test your numbers.",
    steps: [
      { name: "Estimate the value", text: "What is a new customer worth to them, and how many might the site bring?" },
      { name: "Build three packages", text: "Essentials, growth and full service, each with a clear scope." },
      { name: "Anchor on the middle", text: "Make it the best value; most clients choose it." },
      { name: "Set terms", text: "A deposit to start, a timeline, and what counts as a change request." },
    ],
    faqs: [
      { q: "Should I show hourly rates?", a: "For fixed-scope websites, package prices are easier for clients to say yes to." },
      { q: "Can an advisor help with my pricing?", a: "Yes. Ask Juno about your packages and audience; answers are advice, not a quote." },
    ],
    related: ["ask-an-ai-advisor", "get-clients-as-a-freelance-web-designer"],
  },
];
