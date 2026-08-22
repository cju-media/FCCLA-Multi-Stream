{
    "patcher": {
        "fileversion": 1,
        "appversion": {
            "major": 9,
            "minor": 1,
            "revision": 2,
            "architecture": "x64",
            "modernui": 1
        },
        "classnamespace": "box",
        "rect": [ 246.0, 218.0, 826.0, 695.0 ],
        "boxes": [
            {
                "box": {
                    "id": "obj-9",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ -26.5, 545.0, 753.0, 22.0 ],
                    "text": "/usr/local/bin/node /Users/c/Documents/Programming/fccla-shorts-stream/atem-rtmp-trigger/atem-live-monitor.js 192.168.112.23 9.5 11 7415"
                }
            },
            {
                "box": {
                    "id": "obj-37",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 781.5, 446.0, 181.0, 22.0 ],
                    "text": "jit.gl.videoplane @scale 0.5 0.27"
                }
            },
            {
                "box": {
                    "id": "obj-36",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "jit_gl_texture", "" ],
                    "patching_rect": [ 767.0, 395.0, 220.0, 22.0 ],
                    "text": "jit.gl.texture @dim 1080 1920 @adapt 0"
                }
            },
            {
                "box": {
                    "hidden": 1,
                    "id": "obj-21",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 1062.0, 181.0, 58.0, 22.0 ],
                    "text": "loadbang"
                }
            },
            {
                "box": {
                    "id": "obj-18",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1062.0, 211.0, 106.0, 22.0 ],
                    "text": "getsourcelistmenu"
                }
            },
            {
                "box": {
                    "id": "obj-22",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 972.0, 211.0, 76.0, 22.0 ],
                    "text": "getsourcelist"
                }
            },
            {
                "box": {
                    "id": "obj-23",
                    "maxclass": "newobj",
                    "numinlets": 3,
                    "numoutlets": 3,
                    "outlettype": [ "", "", "" ],
                    "patching_rect": [ 942.0, 361.0, 174.0, 22.0 ],
                    "text": "route sourcelist sourcelistmenu"
                }
            },
            {
                "box": {
                    "id": "obj-24",
                    "items": [ "BALCONYMINI.LOCAL (BalconyCam)", ",", "STREAM-MULTIVIEW (HDMI)", ",", "STUDIO-MINI.LOCAL (Content-Display)", ",", "STREAM-PROGRAM (HDMI)" ],
                    "maxclass": "umenu",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [ "int", "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 1022.0, 391.0, 200.0, 22.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-25",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [ "multichannelsignal", "jit_matrix", "" ],
                    "patching_rect": [ 802.0, 271.0, 96.0, 22.0 ],
                    "text": "jit.ndi.receive~ 2"
                }
            },
            {
                "box": {
                    "id": "obj-26",
                    "maxclass": "toggle",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "int" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 802.0, 191.0, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-27",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 802.0, 231.0, 81.0, 22.0 ],
                    "text": "qmetro 30 hz"
                }
            },
            {
                "box": {
                    "id": "obj-16",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [ "jit_matrix", "bang", "" ],
                    "patching_rect": [ 720.0, 521.0, 516.0, 22.0 ],
                    "text": "jit.world shorts @size 540 960 @dim 1080 1920 @visible 0 @enable 1 @erase_color 0. 0. 0. 1."
                }
            },
            {
                "box": {
                    "fontsize": 14.0,
                    "id": "obj-1",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 40.0, 20.0, 620.0, 22.0 ],
                    "text": "ATEM live → jit.rtmp.send~ trigger  |  allowed window: 9:30am–11:00am"
                }
            },
            {
                "box": {
                    "fontsize": 11.0,
                    "id": "obj-2",
                    "linecount": 3,
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 40.0, 46.0, 798.0, 43.0 ],
                    "text": "1) Edit the IP/window in the shell message below, click it to spawn atem-live-monitor.js (send \"shell\" bare first to kill an old one).  2) Runtime arm/status/test/setwindow go over loopback UDP, not through [shell].  3) Configure jit.rtmp.send~'s @url / @streamkey and wire your audio/video chain into it separately."
                }
            },
            {
                "box": {
                    "id": "obj-3",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 40.0, 90.0, 601.0, 22.0 ],
                    "text": "/usr/local/bin/node /Users/c/Documents/Programming/fccla-shorts-stream/atem-rtmp-trigger/atem-live-monitor.js"
                }
            },
            {
                "box": {
                    "id": "obj-48",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 0.0, 126.5, 100.0, 22.0 ],
                    "text": "shell"
                }
            },
            {
                "box": {
                    "fontsize": 11.0,
                    "id": "obj-49",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 150.0, 128.0, 320.0, 19.0 ],
                    "text": "^ kills the running child (send before respawning above)"
                }
            },
            {
                "box": {
                    "id": "obj-47",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 480.0, 128.0, 120.0, 22.0 ],
                    "text": "setwindow 9.5 11"
                }
            },
            {
                "box": {
                    "id": "obj-7",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 610.0, 128.0, 60.0, 22.0 ],
                    "text": "arm 1"
                }
            },
            {
                "box": {
                    "id": "obj-8",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 680.0, 128.0, 60.0, 22.0 ],
                    "text": "arm 0"
                }
            },
            {
                "box": {
                    "id": "obj-5",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 40.0, 166.0, 80.0, 22.0 ],
                    "text": "status"
                }
            },
            {
                "box": {
                    "id": "obj-6",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 130.0, 166.0, 100.0, 22.0 ],
                    "text": "debugstate"
                }
            },
            {
                "box": {
                    "id": "obj-17",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 240.0, 166.0, 60.0, 22.0 ],
                    "text": "test"
                }
            },
            {
                "box": {
                    "id": "obj-46",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 40.0, 196.0, 200.0, 22.0 ],
                    "text": "udpsend 127.0.0.1 7415"
                }
            },
            {
                "box": {
                    "fontsize": 11.0,
                    "id": "obj-50",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 250.0, 196.0, 410.0, 19.0 ],
                    "text": "^ runtime control goes over loopback UDP, not through [shell]"
                }
            },
            {
                "box": {
                    "id": "obj-4",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "bang" ],
                    "patching_rect": [ 40.0, 226.0, 241.0, 22.0 ],
                    "saved_object_attributes": {
                        "shell": "(default)"
                    },
                    "text": "shell"
                }
            },
            {
                "box": {
                    "id": "obj-51",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 300.0, 226.0, 160.0, 22.0 ],
                    "text": "print atem-shell-exit"
                }
            },
            {
                "box": {
                    "id": "obj-10",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 4,
                    "outlettype": [ "", "", "", "" ],
                    "patching_rect": [ 40.0, 264.0, 300.0, 22.0 ],
                    "text": "route start stop status"
                }
            },
            {
                "box": {
                    "id": "obj-11",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 40.0, 306.0, 60.0, 22.0 ],
                    "text": "start"
                }
            },
            {
                "box": {
                    "id": "obj-12",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 120.0, 306.0, 60.0, 22.0 ],
                    "text": "stop"
                }
            },
            {
                "box": {
                    "id": "obj-14",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 220.0, 306.0, 130.0, 22.0 ],
                    "text": "print atem-status"
                }
            },
            {
                "box": {
                    "fontsize": 11.0,
                    "id": "obj-15",
                    "linecount": 2,
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 40.0, 338.0, 620.0, 31.0 ],
                    "text": "Auto-fires: ATEM built-in streaming starts inside the window → \"start\"; ATEM stops streaming → \"stop\". \"test\" above forces \"start\" for wiring checks, bypassing the ATEM and time window."
                }
            },
            {
                "box": {
                    "id": "obj-13",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 40.0, 384.0, 408.0, 22.0 ],
                    "text": "jit.rtmp.send~ @url rtmp://YOUR-SERVER/live @width 1080 @height 1920"
                }
            }
        ],
        "lines": [
            {
                "patchline": {
                    "destination": [ "obj-11", 0 ],
                    "source": [ "obj-10", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-12", 0 ],
                    "source": [ "obj-10", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-14", 0 ],
                    "source": [ "obj-10", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-13", 0 ],
                    "source": [ "obj-11", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-13", 0 ],
                    "source": [ "obj-12", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-46", 0 ],
                    "source": [ "obj-17", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-25", 0 ],
                    "midpoints": [ 1071.5, 262.0, 811.5, 262.0 ],
                    "source": [ "obj-18", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-18", 0 ],
                    "hidden": 1,
                    "source": [ "obj-21", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-25", 0 ],
                    "midpoints": [ 981.5, 262.0, 811.5, 262.0 ],
                    "source": [ "obj-22", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-24", 0 ],
                    "source": [ "obj-23", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-25", 0 ],
                    "midpoints": [ 1122.0, 421.0, 1227.0, 421.0, 1227.0, 262.0, 811.5, 262.0 ],
                    "source": [ "obj-24", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23", 0 ],
                    "midpoints": [ 888.5, 350.0, 951.5, 350.0 ],
                    "source": [ "obj-25", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-36", 0 ],
                    "source": [ "obj-25", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-27", 0 ],
                    "source": [ "obj-26", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-25", 0 ],
                    "source": [ "obj-27", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4", 0 ],
                    "source": [ "obj-3", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-37", 0 ],
                    "source": [ "obj-36", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10", 0 ],
                    "source": [ "obj-4", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-51", 0 ],
                    "source": [ "obj-4", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-46", 0 ],
                    "source": [ "obj-47", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4", 0 ],
                    "source": [ "obj-48", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-46", 0 ],
                    "source": [ "obj-5", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-46", 0 ],
                    "source": [ "obj-6", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-46", 0 ],
                    "source": [ "obj-7", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-46", 0 ],
                    "source": [ "obj-8", 0 ]
                }
            }
        ],
        "autosave": 0
    }
}