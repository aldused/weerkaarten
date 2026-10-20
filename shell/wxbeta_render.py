"""Resume exact-run chart builds and expose only complete PNG files."""
import os
from PIL import Image


def render_task(task):
    renderer, args = task
    target = args[-1]
    if os.environ.get('WXBETA_RERENDER') != '1' and os.path.isfile(target):
        try:
            with Image.open(target) as chart:
                if chart.format != 'PNG':
                    raise ValueError('Geen PNG')
                chart.verify()
            return
        except (OSError, ValueError, SyntaxError):
            pass
    temporary = target + '.incomplete.png'
    renderer(*args[:-1], temporary)
    with Image.open(temporary) as chart:
        chart.verify()
    os.replace(temporary, target)
