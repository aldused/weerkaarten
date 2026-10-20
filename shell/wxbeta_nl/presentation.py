"""Dutch clock labels and Weerlab header/footer shared by every Netherlands layer."""
from zoneinfo import ZoneInfo
from matplotlib.patches import Rectangle
TZ=ZoneInfo('Europe/Amsterdam')
DAYS=('ma','di','wo','do','vr','za','zo')
MONTHS=('jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec')


def local_label(value):
    local=value.astimezone(TZ)
    season='zomertijd' if local.dst().total_seconds() else 'wintertijd'
    return f'{DAYS[local.weekday()]} {local.day} {MONTHS[local.month-1]} · {local:%H:%M} uur ({season})'


def header(fig,title,run,valid,source,region="NEDERLAND"):
    fig.add_artist(Rectangle((0,.895),1,.105,transform=fig.transFigure,facecolor='#102b39',edgecolor='none',zorder=50))
    fig.text(.026,.979,'WEERLAB  /  '+region,fontsize=10,weight='bold',color='#70d6dd',zorder=51)
    fig.text(.026,.95,title,fontsize=18,weight='bold',color='white',zorder=51)
    fig.text(.026,.927,source,fontsize=9.5,color='#c2d4dc',zorder=51)
    fig.text(.974,.979,'GELDIG · NEDERLANDSE TIJD',fontsize=8,ha='right',weight='bold',color='#a7c1cd',zorder=51)
    fig.text(.974,.95,local_label(valid),fontsize=11,weight='bold',ha='right',color='white',zorder=51)
    fig.text(.974,.909,'Modelrun '+local_label(run),fontsize=8.5,ha='right',color='#c2d4dc',zorder=51)


def footer(fig,credit):
    fig.add_artist(Rectangle((0,0),1,.029,transform=fig.transFigure,facecolor='#102b39',edgecolor='none',zorder=50))
    fig.text(.026,.011,'ED ALDUS · WEERLAB',fontsize=9,weight='bold',color='white',zorder=51)
    fig.text(.974,.011,credit,fontsize=7.6,color='#c2d4dc',ha='right',zorder=51)
