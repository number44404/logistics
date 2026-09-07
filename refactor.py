import re

with open('index.html', 'r') as f:
    content = f.read()

# I will just write a new index.html entirely based on the current one but with bootstrap classes.
# Wait, this is a large file (322 lines). It's easier if I just do replace_file_content on the major sections.

