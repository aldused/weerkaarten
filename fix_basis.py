import os
os.chdir(os.path.expanduser("~/Desktop/KNMI_Project/weerkaarten 2"))
c = open('index.html').read()
c = c.replace(
    '&& !n.startsWith("kaart_pluim_") && !n.startsWith("kaart_temp_dag_") && !n.startsWith("kaart_temp_nacht_"))',
    '&& !n.startsWith("kaart_pluim_") && !n.startsWith("kaart_temp_dag_") && !n.startsWith("kaart_temp_nacht_") && !n.startsWith("kaart_basis"))'
)
open('index.html','w').write(c)
print('ok:', 'kaart_basis' in c)
