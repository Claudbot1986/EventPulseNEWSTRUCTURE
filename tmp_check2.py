import json
from collections import Counter

fail_list = []
with open('runtime/sources_status.jsonl') as f:
    for line in f:
        try:
            d = json.loads(line)
            if d.get('status') == 'fail':
                fail_list.append({
                    'sourceId': d['sourceId'],
                    'triageResult': d.get('triageResult', 'N/A')
                })
        except: pass

print(f'TOTAL FAIL: {len(fail_list)}')
triage_counts = Counter(f['triageResult'] for f in fail_list)
for tr, count in triage_counts.most_common():
    print(f'  {tr}: {count}')

html_fails = [f for f in fail_list if f['triageResult'] == 'html_candidate']
print(f'html_candidate fail: {len(html_fails)}')
for f in html_fails:
    print(f'  {f["sourceId"]}')
