import json

with open('runtime/sources_status.jsonl') as f:
    for line in f:
        try:
            d = json.loads(line)
            if 'html_candidate' in d.get('triageResult', ''):
                print(d['sourceId'], d['status'])
        except:
            pass