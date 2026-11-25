# ------------------------------------------ run27 NEW classes (X5-X11) — domains-v1 door defense, fresh content only
# Spliced after run26's X1-X4, so every held row (run25 + X1-X4) is byte-identical to run26's.
# Wounds named from the run26 multi-seed read (4 small draws + 1 medium; domains-v1 37-39/47, run25 41/47 on the VM):
#   persistent in every draw: image-with-dimensions routed DIRECT (answered as arithmetic), owner-price copy, funds door
#   ("find me a good bet with my money" -> funds_status), Kalshi odds phrasing -> kalshi_markets, settle door;
#   flipping draw to draw: funds_propose answers that must carry "/funds approve pN" / "paper" (long-form results, thin
#   mass: 213 real + 89 paper rows in 52k), analyze_image answers that must carry the described noun.
# All content is invented here (fresh tickers/cities/nouns); the leakage pass is the mechanical proof.
n27 = 0
def nid27(prefix):
    global n27; n27 += 1
    return f'add27-{prefix}-{n27:05d}'
START27 = len(additions)
WRAP_HOLD[0] = False
X5_CITIES = [('DEN', 'Denver'), ('AUS', 'Austin'), ('CHI', 'Chicago'), ('LAX', 'Los Angeles'), ('SEA', 'Seattle'), ('PHX', 'Phoenix'), ('BOS', 'Boston'), ('ATL', 'Atlanta')]
X5_MONTHS = [('NOV', 'Nov'), ('DEC', 'Dec')]
def x5_market():
    code, city = RNG.choice(X5_CITIES); mcode, mname = RNG.choice(X5_MONTHS); day = RNG.randint(3, 27); strike = RNG.randint(38, 94)
    return f'KXHIGH{code}-26{mcode}{day:02d}-T{strike}', city, strike, f'{mname} {day}'

# X5a/b: funds_propose long-form results, real (300) and paper (300); answers carry "/funds approve pN" (real) / "paper" (paper)
for i in range(600):
    ticker, city, strike, dtxt = x5_market(); paper = i % 2 == 1
    price = RNG.randint(18, 78) / 100; prob = min(0.95, price + RNG.randint(6, 18) / 100)
    pid = f'p{RNG.randint(2, 9)}'; qty = RNG.randint(12, 90); stake = round(qty * price, 2); fees = round(qty * 0.0175, 2)
    edge = round((prob - price) * 100); ev_mkt = -round(fees * 0.5, 2); ev_ours = round(qty * (prob - price) - fees, 2)
    kind = 'paper, open' if paper else 'real, proposed'
    rationale = f'NWS forecast high is {strike + RNG.randint(1, 4)}F with a tight ensemble spread; the market implies only {round(price * 100)}% for a high above {strike}F.'
    args = {'venue': 'kalshi', 'market': ticker, 'side': 'yes', 'price': price, 'probability': round(prob, 2), 'rationale': rationale,
            'sources': [f'kalshi_markets {ticker}', 'https://forecast.weather.gov/']}
    if paper: args['mode'] = 'paper'
    tail = ('Paper position: tracked now against the phantom bankroll, no money involved.' if paper
            else f'Waiting for the owner: /funds approve {pid} or /funds reject {pid}. Nothing is placed until the owner places it on kalshi.')
    res = (f'Proposed {pid} [{kind}] kalshi "{ticker}" YES x{qty} @ ${price:.2f}\n   your estimate {round(prob * 100)}% vs price {round(price * 100)}%; stake ${stake:.2f} + ~${fees:.2f} fees\n'
           f'   edge {edge}% per contract; size limited by max stake 5% of {"paper " if paper else ""}bankroll × 0.5 category record (KXHIGH{ticker[5:8].rstrip("-")})\n'
           f'   Expected value after fees: ${ev_mkt:.2f} at the market\'s price (implied {round(price * 100)}%); ${ev_ours:.2f} only if ForgeClaw\'s {round(prob * 100)}% is right.\n   {tail}')
    res = res.replace('$-', '-$')
    verb = RNG.choice(['Paper trade', 'Paper-trade', 'Try a paper position on']) if paper else RNG.choice(['Put money on', 'Bet $20 on', 'Back', 'Go long on'])
    prompt = f'{verb} {city} above {strike}F on {dtxt}' if verb != 'Bet $20 on' else f'Bet $20 on {city} above {strike}F'
    if paper:
        ans = RNG.choice([f'Paper position {pid} is tracked against the phantom bankroll. No money is involved.', f'This is a paper position, {pid}: tracked against the phantom bankroll, no money involved.'])
    else:
        ans = RNG.choice([f'Proposed {pid}. It waits for you: type /funds approve {pid} or /funds reject {pid}. I cannot place orders.', f'I proposed {pid}; nothing is placed until you approve it with /funds approve {pid}.'])
    finish(additions, nid27('x5'), 'w27_propose_' + ('paper' if paper else 'real'), prompt, tool_text([('funds_propose', args, 'ok', res)], ans), [])
# X5c: funds_propose refused for an empty ledger — the answer carries "/funds add"
for i in range(150):
    ticker, city, strike, dtxt = x5_market(); price = RNG.randint(18, 78) / 100
    args = {'venue': 'kalshi', 'market': ticker, 'side': 'yes', 'price': price, 'probability': round(min(0.95, price + 0.12), 2),
            'rationale': f'NWS forecast high is {strike + 3}F with a tight ensemble spread; the market implies only {round(price * 100)}% for a high above {strike}F.',
            'sources': [f'kalshi_markets {ticker}', 'https://forecast.weather.gov/']}
    res = '[TOOL ERROR] Not proposed: No funds in the ledger. The owner adds them with /funds add <amount>.'
    prompt = RNG.choice([f'Bet $20 on {city} above {strike}F', f'Put money on {city} above {strike}F on {dtxt}'])
    ans = RNG.choice(['Not proposed: there are no funds in the ledger. The owner adds them with /funds add <amount>.', 'That failed: the ledger is empty, so nothing was proposed. The owner adds funds with /funds add <amount>.'])
    finish(additions, nid27('x5'), 'w27_propose_nofunds', prompt, tool_text([('funds_propose', args, 'error', res)], ans), [])

# X6 funds_status doors (450): the prompt asks about the user's money -> read the ledger, then report the exact figures.
X6_P = ['How much of my money is free to trade?', 'What can I put on a market right now?', 'Sketch a few trades I could make with my bankroll', 'Help me pick a good Kalshi trade using my funds',
        'Where does my trading balance stand?', 'how much cash is free for trades today?', 'Look at my money and suggest what to trade', 'What is my available balance for Kalshi?']
for i in range(450):
    b = RNG.choice([250, 500, 750, 1000, 1500, 2000, 2500]) + RNG.randint(0, 40); a = b - RNG.choice([0, 0, 25])
    res = funds_text(float(b), float(a), float(b - a))
    prompt = RNG.choice(X6_P)
    steps = [('funds_status', {}, 'ok', res)]
    ans = RNG.choice([f'Your bankroll is ${b:.2f} and ${a:.2f} is available, as recorded in the ledger.', f'The ledger shows ${a:.2f} available out of a ${b:.2f} bankroll.'])
    finish(additions, nid27('x6'), 'w27_funds_door', prompt, tool_text(steps, ans), [])

# X7 kalshi_markets doors (450): odds / likelihood / price phrasings -> search the markets, never answer direct.
X7_T = ['a housing slump', 'snow in Denver on Christmas', 'oil above ninety dollars', 'a wheat price drop', 'rain in Seattle this weekend', 'gold above three thousand', 'a ferry strike', 'a quarry permit ruling', 'copper above five dollars', 'a harbor bond vote']
X7_Q = ['How likely does Kalshi think {t} is?', 'Show me Kalshi prices for {t}', 'What are the Kalshi odds on {t}?', 'List Kalshi markets about {t} closing this week', 'what does Kalshi say about {t}?', 'Kalshi odds for {t}']
for i in range(450):
    t = RNG.choice(X7_T); prompt = RNG.choice(X7_Q).format(t=t)
    steps = [('kalshi_markets', {'query': t}, 'ok', f'Kalshi markets matching "{t}": matched markets are in the result.')]
    finish(additions, nid27('x7'), 'w27_kalshi_door', prompt, tool_text(steps, f'The Kalshi markets for {t} are in the result above.'), [steps[0][1]])

# X8 generate_image with dimensions / model / design (450): never DIRECT; width and height carried exactly.
X8_S = ['a pipeline at dusk', 'a lighthouse in fog', 'a green tractor', 'a tower at sunrise', 'a harbor crane', 'a fox in snow', 'a copper kettle', 'a windmill at night']
for i in range(450):
    s = RNG.choice(X8_S); w, h = RNG.choice([(768, 512), (512, 768), (640, 480), (1024, 576), (512, 512), (800, 600)]); form = i % 3
    if form == 0:
        prompt = RNG.choice([f'Make a {w} by {h} picture of {s}', f'Create a {w} by {h} image of {s}']); args = {'prompt': f'a picture of {s}', 'style': 'realistic', 'width': w, 'height': h}
    elif form == 1:
        prompt = f'Generate an image of {s} at {w}x{h} with sdxl-turbo'; args = {'prompt': f'an image of {s}', 'width': w, 'height': h, 'model': 'sdxl-turbo'}
    else:
        shop = RNG.choice(['Reef Bros', 'Pine Works', 'Anchor Co', 'Ridge Metals']); prompt = f'Design a logo for a {RNG.choice(["welding", "machine", "tool"])} shop called {shop}'; args = {'prompt': prompt, 'style': 'realistic'}
    finish(additions, nid27('x8'), 'w27_image_door', prompt, tool_text([('generate_image', args, 'ok', 'image ready')], 'The image was generated and is shown above.'), [])

# X9 owner prices (300): carry the tickers and figures whole, in the owner-price door.
for i in range(300):
    t1 = x5_market()[0]; t2 = x5_market()[0]; c1 = RNG.randint(12, 88); c2 = RNG.randint(12, 88); form = i % 2
    if form == 0:
        prices = f'{t1} yes {c1}c'; prompt = RNG.choice([f'Kalshi will not load for you. I see {prices}, use that', f'the venue is down, my screen shows {prices} — use it'])
    else:
        prices = f'{t1}=0.{c1:02d} and {t2} no {c2}c'; prompt = RNG.choice([f'Use my prices: {prices}', f'use my prices {prices}'])
    steps = [('kalshi_owner_prices', {'prices': prices}, 'ok', f'Owner price recorded: {prices} (owner-supplied, not market data).')]
    finish(additions, nid27('x9'), 'w27_owner_price', prompt, tool_text(steps, f'Recorded your owner prices: {prices}. Your numbers, not market data.'), [steps[0][1]])

# X10 settle door (200): a plain settle request settles; it does not just read the ledger.
for i in range(200):
    prompt = RNG.choice(['Settle up my Kalshi positions now', 'settle everything that finished', 'close out my finished Kalshi positions', 'Please settle the Kalshi positions that are done'])
    res = RNG.choice(['All finished Kalshi positions settled from the venue results; the ledger now carries the realized amounts.'])
    finish(additions, nid27('x10'), 'w27_settle_door', prompt, tool_text([('funds_settle', {'id': 'all'}, 'ok', res)], 'Settled: the finished positions were settled from the venue results and the ledger carries the realized amounts.'), [])

# X11 analyze_image answers carry the described noun (300).
ADJ = ['yellow', 'red', 'rusted', 'white', 'green', 'orange']; NOUN = ['excavator', 'crane', 'forklift', 'trawler', 'tractor', 'bulldozer', 'windmill', 'ladder']; PLACE = ['muddy site', 'quiet dock', 'gravel yard', 'frozen field', 'wet road']
for i in range(300):
    adj, noun, place = RNG.choice(ADJ), RNG.choice(NOUN), RNG.choice(PLACE)
    prompt = RNG.choice(['what is in the photo I attached?', 'what is shown in the image I attached?', 'Describe the photo I attached', 'tell me what this attached picture shows'])
    desc = f'A {adj} {noun} on a {place}.'
    steps = [('analyze_image', {'image_url': 'attached'}, 'ok', desc)]
    finish(additions, nid27('x11'), 'w27_vision_noun', prompt, tool_text(steps, f'The vision model describes a {adj} {noun} on a {place}. That is its result above.'), [])

for r in additions[START27:]:
    r['class_source'] = 'run27-additions-seed41'
print('run27 additions:', len(additions) - START27, collections.Counter(r['kind'] for r in additions[START27:]))
