import re

with open('frontend/receiver.html', 'r') as f:
    content = f.read()

content = re.sub(
    r'function downloadReceiverReceipt\(\) \{[\s\S]*?receiptWindow\.document\.close\(\);\n        \}',
    '',
    content
)

with open('frontend/receiver.html', 'w') as f:
    f.write(content)

