;; Rebuild with WABT 1.0.39: wat2wasm portraitSimilarity.wat -o portraitSimilarity.wasm
(module
  (memory (export "memory") 8)
  (func $dot (param $a i32) (param $b i32) (param $n i32) (result f64)
    (local $v v128) (local $w v128) (local $end i32)
    (local.set $end (i32.add (local.get $a) (i32.shl (local.get $n) (i32.const 3))))
    (loop $next
      (local.set $v (f64x2.add (local.get $v) (f64x2.mul (v128.load (local.get $a)) (v128.load (local.get $b)))))
      (local.set $w (f64x2.add (local.get $w) (f64x2.mul (v128.load offset=16 (local.get $a)) (v128.load offset=16 (local.get $b)))))
      (local.set $a (i32.add (local.get $a) (i32.const 32)))
      (local.set $b (i32.add (local.get $b) (i32.const 32)))
      (br_if $next (i32.lt_u (local.get $a) (local.get $end))))
    (local.set $v (f64x2.add (local.get $v) (local.get $w)))
    (f64.add (f64x2.extract_lane 0 (local.get $v)) (f64x2.extract_lane 1 (local.get $v))))

  ;; Each slot holds padded pixel features, 192 projected channels and the residual norm.
  ;; Return frame indices whose upper bound and pixel dot both reach the cutoff.
  (func (export "potentialMatches") (param $length i32) (param $count i32) (param $stride i32)
                                  (param $cutoff f64) (result i32)
    (local $frame i32) (local $index i32) (local $matches i32)
    (local $blocks i32) (local $residual i32)
    (local.set $blocks (i32.shl (local.get $length) (i32.const 3)))
    (local.set $residual (i32.add (local.get $blocks) (i32.const 1536)))
    (local.set $frame (local.get $stride))
    (loop $views
      (if (f64.ge
            (f64.add (call $dot (local.get $blocks) (i32.add (local.get $frame) (local.get $blocks)) (i32.const 192))
                     (f64.mul (f64.load (local.get $residual))
                              (f64.load (i32.add (local.get $frame) (local.get $residual)))))
            (local.get $cutoff))
        (then
          (if (f64.ge (call $dot (i32.const 0) (local.get $frame) (local.get $length)) (local.get $cutoff))
            (then (local.set $matches (i32.or (local.get $matches) (i32.shl (i32.const 1) (local.get $index))))))))
      (local.set $frame (i32.add (local.get $frame) (local.get $stride)))
      (local.set $index (i32.add (local.get $index) (i32.const 1)))
      (br_if $views (i32.lt_u (local.get $index) (local.get $count))))
    (local.get $matches)))
