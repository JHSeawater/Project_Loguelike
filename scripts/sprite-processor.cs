using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;
using System.Linq;

public class SpriteFrame {
    public int[] SourceRect;
    public double[] SourceFoot;
    public double Scale;
    public int DirectionRow, Column;
}
public class SpriteSheet {
    public string Animation;
    public int Columns;
    public SpriteFrame[] Frames;
}
public class SpriteOptions {
 public string Id, MagicMode;
 public int Width, Height, AnchorX, AnchorY, TargetHeight, MinArea=3000, Alpha=128, CoreAlpha=240, PartArea=30;
 public bool KeepParts;
 public int[] SourceRows, Rects;
}
public class SpriteProcessor {
 static SpriteOptions current;
 public static void Preview(string folder,string path,string id,string[] actions,int[] columns,int fw,int fh,bool magic) {
    using(var board=new Bitmap(fw*2*actions.Length,fh*4+20)) using(var g=Graphics.FromImage(board)) {
        g.Clear(Color.FromArgb(40,44,52));
        using(var font=new Font(FontFamily.GenericMonospace,8))
            for(int a=0;a<actions.Length;a++) g.DrawString(actions[a]+" 0 / middle",font,Brushes.White,a*2*fw,2);
        for(int a=0;a<actions.Length;a++) using(var body=new Bitmap(Path.Combine(folder,id+"_"+actions[a]+".png"))) {
            using(var fx=magic?new Bitmap(Path.Combine(folder,id+"_"+actions[a]+"_magic.png")):null) {
                for(int r=0;r<4;r++) for(int c=0;c<2;c++) {
                    var dst=new Rectangle((a*2+c)*fw,r*fh+20,fw,fh);
                    var src=new Rectangle((c==0?0:columns[a]/2)*fw,r*fh,fw,fh);
                    g.DrawImage(body,dst,src,GraphicsUnit.Pixel);
                    if(fx!=null) g.DrawImage(fx,dst,src,GraphicsUnit.Pixel);
                }
            }
        }
        board.Save(path,ImageFormat.Png);
    }
 }
    class Shape { public int X, Y, W, H, Area, Seed; }
    class Frame {
        public int X, Y, W, H, FootY;
        public double FootX;
        public int[] Pixels;
        public bool[] Body;
        public Shape Bounds;
    }
    static Shape[] Components(bool[] mask, int w, int h, int minimum) {
        var visited = new bool[mask.Length];
        var found = new List<Shape>();
        var queue = new Queue<int>();
        for (int start = 0; start < mask.Length; start++) {
            if (!mask[start] || visited[start]) continue;
            visited[start] = true; queue.Enqueue(start);
            int left = w, top = h, right = -1, bottom = -1, area = 0;
            while (queue.Count > 0) {
                int p = queue.Dequeue(), x = p % w, y = p / w;
                left = Math.Min(left, x); top = Math.Min(top, y);
                right = Math.Max(right, x); bottom = Math.Max(bottom, y); area++;
                for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                    int nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    int n = ny * w + nx;
                    if (mask[n] && !visited[n]) { visited[n] = true; queue.Enqueue(n); }
                }
            }
            if (area >= minimum) found.Add(new Shape { X = left, Y = top, W = right-left+1, H = bottom-top+1, Area = area, Seed = start });
        }
        return found.ToArray();
    }
    public static void Validate(string file,int fw,int fh,int columns,int anchorY,bool body,bool requireVisible) {
        using(var b=new Bitmap(file)) {
            if(b.Width!=fw*columns||b.Height!=fh*4) throw new Exception("Wrong sheet dimensions");
            int visible=0;
            for(int r=0;r<4;r++) for(int c=0;c<columns;c++) {
                int count=0,bottom=-1;
                for(int y=0;y<fh;y++) for(int x=0;x<fw;x++) {
                    var p=b.GetPixel(c*fw+x,r*fh+y);
                    if(p.A>0) visible++;
                    if(body && p.A!=0 && p.A!=255) throw new Exception("Body alpha is not binary");
                    if(body && p.A>0) {
                        if(x<2||x>=fw-2||y<2||y>=anchorY) throw new Exception("Clipped body at row "+r+", column "+c);
                        count++;bottom=Math.Max(bottom,y);
                    }
                }
                if(body && (count<100||bottom!=anchorY-1)) throw new Exception("Empty body or wrong foot at row "+r+", column "+c);
            }
            if(requireVisible&&visible==0) throw new Exception("Required layer is empty");
        }
    }
    static bool Magic(int argb) {
        int r = (argb >> 16) & 255, g = (argb >> 8) & 255, b = argb & 255;
        if(current.MagicMode=="none") return false;
        if(current.MagicMode=="red") return r>=80 && r-g>=25 && r-b>=15;
        if(current.MagicMode=="cyan") return g>=65 && g-r>=15 && b-r>=5;
        return (g >= 64 && g-r >= 20 && g-b >= 10 && g >= r * 1.18)
            || (g > 210 && r > 175 && b > 150 && g >= r && g >= b);
    }
    static bool[] Exterior(bool[] solid, int w, int h) {
        var outside = new bool[solid.Length]; var queue = new Queue<int>();
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            if (x != 0 && y != 0 && x != w-1 && y != h-1) continue;
            int p = y*w+x;
            if (!solid[p] && !outside[p]) { outside[p] = true; queue.Enqueue(p); }
        }
        int[] dx = { -1, 1, 0, 0 }, dy = { 0, 0, -1, 1 };
        while (queue.Count > 0) {
            int p = queue.Dequeue(), x = p%w, y = p/w;
            for (int i = 0; i < 4; i++) {
                int nx=x+dx[i], ny=y+dy[i];
                if(nx<0 || ny<0 || nx>=w || ny>=h) continue;
                int n=ny*w+nx;
                if(!solid[n] && !outside[n]) { outside[n]=true; queue.Enqueue(n); }
            }
        }
        return outside;
    }
    static Frame Extract(int[] pixels, int width, int x, int y, int w, int h) {
        var frame = new Frame { X=x, Y=y, W=w, H=h, Pixels=new int[w*h] };
        var solid = new bool[w*h];
        for(int py=0;py<h;py++) for(int px=0;px<w;px++) {
            int p=py*w+px, color=pixels[(y+py)*width+x+px]; frame.Pixels[p]=color;
            solid[p]=((uint)color>>24)>=current.Alpha && !Magic(color);
        }
        var outside=Exterior(solid,w,h);
        for(int p=0;p<solid.Length;p++) if(!outside[p] && ((uint)frame.Pixels[p]>>24)>=current.Alpha) solid[p]=true;
        var largest=Components(solid,w,h,1).OrderByDescending(s=>s.Area).First();
        var body=new bool[solid.Length]; var queue=new Queue<int>();
        // Seed from a pixel of the largest shape itself; its bounding box may overlap other shapes.
        int seed=largest.Seed;
        if(current.KeepParts) {
            foreach(var part in Components(solid,w,h,current.PartArea)) {
                for(int yy=part.Y;yy<part.Y+part.H;yy++) for(int xx=part.X;xx<part.X+part.W;xx++) {
                    int p=yy*w+xx;
                    if(solid[p]&&!body[p]) {queue.Enqueue(p);body[p]=true;}
                }
            }
        } else {queue.Enqueue(seed); body[seed]=true;}
        while(queue.Count>0) {
            int p=queue.Dequeue(), px=p%w, py=p/w;
            for(int oy=-1;oy<=1;oy++) for(int ox=-1;ox<=1;ox++) {
                int nx=px+ox, ny=py+oy;
                if(nx<0 || ny<0 || nx>=w || ny>=h) continue;
                int n=ny*w+nx;
                if(solid[n] && !body[n]) {body[n]=true;queue.Enqueue(n);}
            }
        }
        if(current.KeepParts) {
            int left=w,top=h,right=-1,bottom=-1;
            for(int p=0;p<body.Length;p++) if(body[p]) {
                left=Math.Min(left,p%w);right=Math.Max(right,p%w);
                top=Math.Min(top,p/w);bottom=Math.Max(bottom,p/w);
            }
            largest=new Shape {X=left,Y=top,W=right-left+1,H=bottom-top+1};
        }
        frame.Body=body; frame.Bounds=largest; frame.FootY=largest.Y+largest.H;
        int footLeft=w,footRight=-1;
        for(int py=largest.Y+(int)(largest.H*0.8);py<frame.FootY;py++) for(int px=0;px<w;px++)
            if(body[py*w+px]) {footLeft=Math.Min(footLeft,px);footRight=Math.Max(footRight,px);}
        frame.FootX=(footLeft+footRight+1)/2.0;
        return frame;
    }
    public static SpriteSheet Process(string source, string output, string animation, int columns, SpriteOptions options) {
        current=options;
        using(var bitmap=new Bitmap(source)) {
            int width=bitmap.Width,height=bitmap.Height;
            var pixels=new int[width*height]; var core=new bool[pixels.Length];
            for(int y=0;y<height;y++) for(int x=0;x<width;x++) {
                int p=y*width+x; pixels[p]=bitmap.GetPixel(x,y).ToArgb(); core[p]=((uint)pixels[p]>>24)>=current.CoreAlpha;
            }
            var shapes=Components(core,width,height,current.MinArea).OrderBy(s=>s.Y+s.H/2.0).ToArray();
            if(current.Rects==null && shapes.Length!=columns*4) throw new Exception("Expected "+(columns*4)+" core frames, found "+shapes.Length);
            var rows=new Shape[4][];
            var rowCenters=new double[4];
            for(int r=0;r<4 && current.Rects==null;r++) {
                rows[r]=shapes.Skip(r*columns).Take(columns).OrderBy(s=>s.X+s.W/2.0).ToArray();
                rowCenters[r]=rows[r].Average(s=>s.Y+s.H/2.0);
            }
            using(var bodySheet=new Bitmap(columns*current.Width,4*current.Height,PixelFormat.Format32bppArgb))
            using(var magicSheet=new Bitmap(columns*current.Width,4*current.Height,PixelFormat.Format32bppArgb)) {
                var metadata=new List<SpriteFrame>();
                int[] sourceRows=current.SourceRows;
                for(int r=0;r<4;r++) {
                    int sr=sourceRows[r];
                    int top=current.Rects!=null?0:sr==0?0:(int)((rowCenters[sr-1]+rowCenters[sr])/2);
                    int bottom=current.Rects!=null?height:sr==3?height:(int)((rowCenters[sr]+rowCenters[sr+1])/2);
                    var frames=new List<Frame>();
                    for(int c=0;c<columns;c++) {
                        if(current.Rects!=null) {
                            int at=(sr*columns+c)*4;
                            if(current.Rects[at]<0||current.Rects[at+1]<0||current.Rects[at+2]<1||current.Rects[at+3]<1
                                ||current.Rects[at]+current.Rects[at+2]>width||current.Rects[at+1]+current.Rects[at+3]>height)
                                throw new Exception("Source rectangle outside image at row "+sr+", column "+c);
                            frames.Add(Extract(pixels,width,current.Rects[at],current.Rects[at+1],current.Rects[at+2],current.Rects[at+3]));
                            continue;
                        }
                        double mid=rows[sr][c].X+rows[sr][c].W/2.0;
                        int left=c==0?0:(int)((rows[sr][c-1].X+rows[sr][c-1].W/2.0+mid)/2);
                        int right=c==columns-1?width:(int)((mid+rows[sr][c+1].X+rows[sr][c+1].W/2.0)/2);
                        frames.Add(Extract(pixels,width,left,top,right-left,bottom-top));
                    }
                    var heights=frames.Select(f=>f.Bounds.H).OrderBy(v=>v).ToArray();
                    double median=(heights[(columns-1)/2]+heights[columns/2])/2.0;
                    double scale=current.TargetHeight/median;
                    foreach(var f in frames) {
                        scale=Math.Min(scale,(current.AnchorX-2.0)/(f.FootX-f.Bounds.X));
                        scale=Math.Min(scale,(current.Width-current.AnchorX-2.0)/(f.Bounds.X+f.Bounds.W-f.FootX));
                        scale=Math.Min(scale,(current.AnchorY-2.0)/f.Bounds.H);
                    }
                    for(int c=0;c<columns;c++) {
                        var f=frames[c]; var body=new int[current.Width*current.Height]; var magic=new int[current.Width*current.Height];int lastY=-1;
                        for(int y=0;y<current.Height;y++) for(int x=0;x<current.Width;x++) {
                            int sx=(int)Math.Floor(f.FootX+(x+0.5-current.AnchorX)/scale);
                            int sy=(int)Math.Floor(f.FootY+(y+0.5-current.AnchorY)/scale);
                            if(sx<0 || sy<0 || sx>=f.W || sy>=f.H) continue;
                            int p=sy*f.W+sx,color=f.Pixels[p];
                            if(f.Body[p]) {body[y*current.Width+x]=unchecked((int)0xff000000)|(color&0xffffff);lastY=Math.Max(lastY,y);}
                            else if(((uint)color>>24)>=32 && Magic(color)) magic[y*current.Width+x]=color;
                        }
                        if(lastY<0) throw new Exception("Empty body frame");
                        int shift=current.AnchorY-1-lastY;
                        for(int y=0;y<current.Height;y++) for(int x=0;x<current.Width;x++) {
                            int sy=y-shift;
                            if(sy<0 || sy>=current.Height) continue;
                            bodySheet.SetPixel(c*current.Width+x,r*current.Height+y,Color.FromArgb(body[sy*current.Width+x]));
                            magicSheet.SetPixel(c*current.Width+x,r*current.Height+y,Color.FromArgb(magic[sy*current.Width+x]));
                        }
                        metadata.Add(new SpriteFrame {DirectionRow=r,Column=c,Scale=scale,
                            SourceRect=new int[]{f.X,f.Y,f.W,f.H},SourceFoot=new double[]{f.X+f.FootX,f.Y+f.FootY}});
                    }
                }
                bodySheet.Save(Path.Combine(output,current.Id+"_"+animation+".png"),ImageFormat.Png);
                if(current.MagicMode!="none") magicSheet.Save(Path.Combine(output,current.Id+"_"+animation+"_magic.png"),ImageFormat.Png);
                return new SpriteSheet {Animation=animation,Columns=columns,Frames=metadata.ToArray()};
            }
        }
    }
}
public class StripOptions {
    public string Id, Align, Split="gap";
    public int Frames, Width, Height, PivotX, PivotY, TargetWidth, Alpha=32;
    public bool BinaryAlpha;
    public int BaseColor;
    public string[] Suffixes;
    public int[] Colors;
}
public class StripFrame {
    public int Column;
    public int[] SourceRect, NativeSize, Offset;
    public double Scale;
}
// Shrinks an upscaled one-row source: finds frames by the widest empty-column gaps, then samples the middle of each
// output pixel's source box at one shared scale, so the widest frame becomes TargetWidth pixels wide.
public class StripProcessor {
    static int[] Read(string file, out int w, out int h) {
        using(var b=new Bitmap(file)) {
            w=b.Width; h=b.Height;
            var d=b.LockBits(new Rectangle(0,0,w,h),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
            var px=new int[w*h]; System.Runtime.InteropServices.Marshal.Copy(d.Scan0,px,0,px.Length); b.UnlockBits(d); return px;
        }
    }
    static int A(int c) { return (int)((uint)c>>24); }
    static double HueOf(int rgb) {
        double r=((rgb>>16)&255)/255.0, g=((rgb>>8)&255)/255.0, b=(rgb&255)/255.0;
        double max=Math.Max(r,Math.Max(g,b)), min=Math.Min(r,Math.Min(g,b)), d=max-min;
        if(d==0) return 0;
        double h=max==r?(g-b)/d+(g<b?6:0):max==g?(b-r)/d+2:(r-g)/d+4; return h/6;
    }
    // Palette variant: rotate hue only, keeping each pixel's saturation, lightness and alpha.
    static int Shift(int argb, double shift) {
        double r=((argb>>16)&255)/255.0, g=((argb>>8)&255)/255.0, b=(argb&255)/255.0;
        double max=Math.Max(r,Math.Max(g,b)), min=Math.Min(r,Math.Min(g,b)), l=(max+min)/2, d=max-min;
        if(d==0) return argb;
        double s=l>0.5?d/(2-max-min):d/(max+min), h=((HueOf(argb)+shift)%1+1)%1;
        double q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
        Func<double,double> f=t=>{ t=(t%1+1)%1; return t<1/6.0?p+(q-p)*6*t:t<0.5?q:t<2/3.0?p+(q-p)*(2/3.0-t)*6:p; };
        int R=(int)Math.Round(f(h+1/3.0)*255), G=(int)Math.Round(f(h)*255), B=(int)Math.Round(f(h-1/3.0)*255);
        return (argb&unchecked((int)0xff000000))|(R<<16)|(G<<8)|B;
    }
    public static StripFrame[] Process(string source, string output, StripOptions o) {
        int w,h; var px=Read(source,out w,out h);
        var bounds=new List<int[]>();
        if(o.Split=="valley") {
            // Glow can join neighboring frames, so cut at the faintest column near each even split instead of at empty columns.
            var mass=new double[w];
            for(int x=0;x<w;x++) for(int y=0;y<h;y++) mass[x]+=A(px[y*w+x]);
            double slot=w/(double)o.Frames; var edges=new List<int>{0};
            for(int k=1;k<o.Frames;k++) {
                int from=(int)(k*slot-0.3*slot), to=(int)(k*slot+0.3*slot), best=from; double low=double.MaxValue;
                for(int x=from;x<=to;x++) {
                    double s=0; for(int d=-4;d<=4;d++) s+=mass[Math.Min(w-1,Math.Max(0,x+d))];
                    if(s<low) { low=s; best=x; }
                }
                edges.Add(best);
            }
            edges.Add(w);
            for(int f=0;f<o.Frames;f++) {
                int left=w,right=0,top=h,bottom=0;
                for(int y=0;y<h;y++) for(int x=edges[f];x<edges[f+1];x++) if(A(px[y*w+x])>=o.Alpha) { left=Math.Min(left,x);right=Math.Max(right,x+1);top=Math.Min(top,y);bottom=Math.Max(bottom,y+1); }
                if(right<=left) throw new Exception("Empty frame "+f);
                bounds.Add(new[]{left,top,right,bottom});
            }
        } else {
            var occupied=new bool[w];
            for(int x=0;x<w;x++) for(int y=0;y<h && !occupied[x];y++) if(A(px[y*w+x])>=o.Alpha) occupied[x]=true;
            var runs=new List<int[]>();
            for(int x=0;x<w;x++) if(occupied[x]) { int s=x; while(x<w&&occupied[x]) x++; runs.Add(new[]{s,x}); }
            if(runs.Count<o.Frames) throw new Exception("Expected "+o.Frames+" frames, found "+runs.Count+" column groups");
            var cuts=Enumerable.Range(1,runs.Count-1).OrderByDescending(i=>runs[i][0]-runs[i-1][1]).Take(o.Frames-1).OrderBy(i=>i).ToList();
            int first=0;
            foreach(var cut in cuts.Concat(new[]{runs.Count})) {
                int left=runs[first][0], right=runs[cut-1][1], top=h, bottom=0;
                for(int y=0;y<h;y++) for(int x=left;x<right;x++) if(A(px[y*w+x])>=o.Alpha) { top=Math.Min(top,y); bottom=Math.Max(bottom,y+1); }
                bounds.Add(new[]{left,top,right,bottom}); first=cut;
            }
        }
        double period=bounds.Max(b=>b[2]-b[0])/(double)o.TargetWidth;
        var sheets=new int[o.Suffixes.Length][];
        for(int k=0;k<sheets.Length;k++) sheets[k]=new int[o.Frames*o.Width*o.Height];
        var frames=new StripFrame[o.Frames];
        for(int f=0;f<o.Frames;f++) {
            var r=bounds[f];
            double sx=r[0], sy=r[1];
            int nw=(int)Math.Ceiling((r[2]-sx)/period), nh=(int)Math.Ceiling((r[3]-sy)/period);
            var native=new int[nw*nh];
            for(int j=0;j<nh;j++) for(int i=0;i<nw;i++) {
                double sa=0,sr=0,sg=0,sb=0; int n=0;
                // At mild reductions the middle half of a box can hold no whole source pixel; always sample at least one.
                int y0=(int)(sy+(j+0.25)*period), y1=Math.Max(y0+1,(int)(sy+(j+0.75)*period));
                int x0=(int)(sx+(i+0.25)*period), x1=Math.Max(x0+1,(int)(sx+(i+0.75)*period));
                for(int y=y0;y<y1;y++) for(int x=x0;x<x1;x++) {
                    if(x<0||y<0||x>=w||y>=h) continue;
                    int c=px[y*w+x], a=A(c); sa+=a; sr+=((c>>16)&255)*a; sg+=((c>>8)&255)*a; sb+=(c&255)*a; n++;
                }
                if(n==0||sa==0) continue;
                int alpha=(int)Math.Round(sa/n);
                alpha=o.BinaryAlpha?(alpha>=128?255:0):(alpha<24?0:alpha>230?255:alpha);
                if(alpha==0) continue;
                native[j*nw+i]=(alpha<<24)|((int)Math.Round(sr/sa)<<16)|((int)Math.Round(sg/sa)<<8)|(int)Math.Round(sb/sa);
            }
            int minX=nw,minY=nh,maxX=-1,maxY=-1;
            for(int j=0;j<nh;j++) for(int i=0;i<nw;i++) if(native[j*nw+i]!=0) { minX=Math.Min(minX,i);maxX=Math.Max(maxX,i);minY=Math.Min(minY,j);maxY=Math.Max(maxY,j); }
            if(maxX<0) throw new Exception("Empty frame "+f);
            double ax=(minX+maxX+1)/2.0, ay=(minY+maxY+1)/2.0;
            if(o.Align=="core") {
                // The glowing core is the brightest quarter of the solid pixels; the trail stays behind it.
                var solid=new List<int[]>();
                for(int j=0;j<nh;j++) for(int i=0;i<nw;i++) { int c=native[j*nw+i]; if(A(c)>=200) solid.Add(new[]{i,j,((c>>16)&255)*3+((c>>8)&255)*6+(c&255)}); }
                if(solid.Count>0) ax=solid.OrderByDescending(s=>s[2]).Take(Math.Max(1,solid.Count/4)).Average(s=>s[0])+0.5;
            }
            int ox=(int)Math.Round(o.PivotX-ax), oy=(int)Math.Round(o.PivotY-ay);
            // Ground effects (light pillars, dirt mounds) stand on the cell bottom; the pivot then marks their origin on the ground.
            if(o.Align=="bottom") oy=o.Height-(maxY+1);
            for(int j=0;j<nh;j++) for(int i=0;i<nw;i++) {
                int c=native[j*nw+i]; if(c==0) continue;
                int x=i+ox, y=j+oy;
                if(x<0||y<0||x>=o.Width||y>=o.Height) throw new Exception("Frame "+f+" ("+(maxX-minX+1)+"x"+(maxY-minY+1)+") does not fit the "+o.Width+"x"+o.Height+" cell");
                for(int k=0;k<sheets.Length;k++) {
                    double shift=HueOf(o.Colors[k])-HueOf(o.BaseColor);
                    sheets[k][y*o.Width*o.Frames+f*o.Width+x]=shift==0?c:Shift(c,shift);
                }
            }
            frames[f]=new StripFrame{Column=f,SourceRect=new[]{r[0],r[1],r[2]-r[0],r[3]-r[1]},NativeSize=new[]{maxX-minX+1,maxY-minY+1},Offset=new[]{ox,oy},Scale=1/period};
        }
        for(int k=0;k<sheets.Length;k++) using(var b=new Bitmap(o.Frames*o.Width,o.Height,PixelFormat.Format32bppArgb)) {
            var d=b.LockBits(new Rectangle(0,0,b.Width,b.Height),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb);
            System.Runtime.InteropServices.Marshal.Copy(sheets[k],0,d.Scan0,sheets[k].Length); b.UnlockBits(d);
            b.Save(Path.Combine(output,o.Id+o.Suffixes[k]+".png"),ImageFormat.Png);
        }
        return frames;
    }
    public static void Validate(string file,int fw,int fh,int frames,bool binary) {
        int w,h; var px=Read(file,out w,out h);
        if(w!=fw*frames||h!=fh) throw new Exception("Wrong sheet dimensions");
        for(int f=0;f<frames;f++) {
            int count=0;
            for(int y=0;y<fh;y++) for(int x=0;x<fw;x++) {
                int c=px[y*w+f*fw+x], a=A(c);
                if(a==0 && c!=0) throw new Exception("Transparent pixel keeps color");
                if(binary && a!=0 && a!=255) throw new Exception("Alpha is not binary");
                if(a>0) count++;
            }
            if(count<8) throw new Exception("Empty frame "+f);
        }
    }
    public static void Preview(string[] files,string path,int fw,int fh,int frames,int scale) {
        using(var board=new Bitmap(fw*frames*scale,(fh*scale+4)*files.Length)) using(var g=Graphics.FromImage(board)) {
            g.Clear(Color.FromArgb(40,44,52));
            g.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
            g.PixelOffsetMode=System.Drawing.Drawing2D.PixelOffsetMode.Half;
            for(int i=0;i<files.Length;i++) using(var b=new Bitmap(files[i])) g.DrawImage(b,new Rectangle(0,i*(fh*scale+4),fw*frames*scale,fh*scale));
            board.Save(path,ImageFormat.Png);
        }
    }
}
