import struct, collections, sys
M=0xFFFFFFFF
def rot(x,k): return ((x<<k)|(x>>(32-k)))&M
def hashlittle(s,init=0):
    b=s.encode(); n=len(b)
    a=bb=c=(0xdeadbeef+n+init)&M
    i=0
    while n-i>12:
        a=(a+int.from_bytes(b[i:i+4],'little'))&M; bb=(bb+int.from_bytes(b[i+4:i+8],'little'))&M; c=(c+int.from_bytes(b[i+8:i+12],'little'))&M
        a=(a-c)&M; a^=rot(c,4); c=(c+bb)&M
        bb=(bb-a)&M; bb^=rot(a,6); a=(a+c)&M
        c=(c-bb)&M; c^=rot(bb,8); bb=(bb+a)&M
        a=(a-c)&M; a^=rot(c,16); c=(c+bb)&M
        bb=(bb-a)&M; bb^=rot(a,19); a=(a+c)&M
        c=(c-bb)&M; c^=rot(bb,4); bb=(bb+a)&M
        i+=12
    r=b[i:]+b'\0'*12
    if n-i==0: return c
    a=(a+int.from_bytes(r[0:4],'little'))&M; bb=(bb+int.from_bytes(r[4:8],'little'))&M; c=(c+int.from_bytes(r[8:12],'little'))&M
    c^=bb; c=(c-rot(bb,14))&M
    a^=c; a=(a-rot(c,11))&M
    bb^=a; bb=(bb-rot(a,25))&M
    c^=bb; c=(c-rot(bb,16))&M
    a^=c; a=(a-rot(c,4))&M
    bb^=a; bb=(bb-rot(a,14))&M
    c^=bb; c=(c-rot(bb,24))&M
    return c
def scan(path):
    d=open(path,'rb').read()   # read-only
    off=44; ents=[]
    while off+32<=len(d) and d[off:off+4]==b'XFTH':
        region,push,uid,th,rid,sz,st=struct.unpack_from('<IIIIIIB',d,off+4)
        ents.append((region,push,th,rid,sz,st)); off+=32+sz
    return ents,off,len(d)
if __name__=='__main__':
    p=sys.argv[1]
    ents,off,n=scan(p)
    print('entries',len(ents),'parsed to',off,'of',n)
    names=sys.argv[2:]
    nm={hashlittle(x.upper()):x for x in names}|{hashlittle(x):x for x in names}
    c=collections.Counter(e[2] for e in ents)
    for th,k in c.most_common(): print(hex(th),k,nm.get(th,''))
