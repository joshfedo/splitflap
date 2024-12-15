import React, {ReactNode, SyntheticEvent, useCallback, useEffect, useRef, useState} from 'react'
import Typography from '@mui/material/Typography'
import Container from '@mui/material/Container'
import {PB} from 'splitflapjs-proto'
import {
    Alert,
    AlertTitle,
    AppBar,
    Button,
    Card,
    CardContent,
    Checkbox,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControlLabel,
    Link,
    Switch,
    TextField,
    Toolbar,
    Tooltip,
} from '@mui/material'
import {NoUndefinedField} from './util'
import {SplitflapWebSerial} from 'splitflapjs-webserial'
import {applyResetModule, applySetFlaps} from 'splitflapjs-core/dist/util'

const LEGACY_FLAPS = [
    ' ', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I',
    'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S',
    'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '0', '1', '2',
    '3', '4', '5', '6', '7', '8', '9', '.', ',', "'",
]

const FLAP_COLOR_BLOCKS: Record<string, string> = {
    'g': '#66d7d1',
    'p': '#7a28cb',
    'r': '#e63946',
    'w': '#eeeeee',
    'y': '#ffd639',
}


type Config = NoUndefinedField<PB.ISplitflapConfig>

const defaultConfig: Config = {
    modules: []
}

type LogLine = [Date, string]
type LogDisplay = {
    lastN: number,
    after?: Date,
    title: string,
    body: string,
}

const renderFlapCharacter = (flapCharacter: string): ReactNode =>
    FLAP_COLOR_BLOCKS[flapCharacter] !== undefined ? (
        <span style={{color: FLAP_COLOR_BLOCKS[flapCharacter]}}>█</span>
    ) : (String(flapCharacter).replace(' ', "\u00A0"))

export type AppProps = object
export const App: React.FC<AppProps> = () => {
    const [splitflap, setSplitflap] = useState<SplitflapWebSerial | null>(null)
    const [splitflapState, setSplitflapState] = useState<NoUndefinedField<PB.ISplitflapState>>(
        PB.SplitflapState.toObject(PB.SplitflapState.create(), {
            defaults: true,
        }) as NoUndefinedField<PB.ISplitflapState>,
    )
    const [splitflapGeneralState, setSplitflapGeneralState] = useState<NoUndefinedField<PB.IGeneralState> | null>();
    const [inputValue, setInputValue] = useState({val: '', user: true});

    // Flap character set defaults to the legacy set, but will be updated if we get a GeneralState message
    // from firmware that supports reporting the flap character set.
    const [flapCharacterSet, setFlapCharacterSet] = useState(LEGACY_FLAPS)
    const legalString = (s: string) => {
        for (const c of s) {
            if (!flapCharacterSet.includes(c) && !Object.values(FLAP_COLOR_BLOCKS).includes(c)) {
                return false
            }
        }
        return true
    }

    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const {value} = event.target;
        const upper = value.toUpperCase()
        if (legalString(upper)) {
            setInputValue({val: upper, user: true});
        }
    };
    const [splitflapConfig, setSplitflapConfig] = useState<Config>(defaultConfig)
    useEffect(() => {
        console.log('send config', splitflapConfig)
        splitflap?.sendConfig(PB.SplitflapConfig.create(splitflapConfig))
    }, [
        splitflap,
        splitflapConfig.modules,
    ])

    useEffect(() => {
        if (splitflapConfig.modules.length !== splitflapState.modules.length) {
            setSplitflapConfig({
                modules: Array(splitflapState.modules.length).fill(null).map(() => {
                    return {targetFlapIndex: 0, resetNonce: 0, movementNonce: 0}
                })
            })
        }
    }, [splitflapConfig, splitflapState])

    const [splitflapLogs, setSplitflapLogs] = useState<Array<LogLine>>([])
    const [unsavedCalibration, setUnsavedCalibration] = useState<boolean>(false)
    const [logDisplay, setLogDisplay] = useState<LogDisplay | null>(null)
    const [showDebugInfo, setShowDebugInfo] = useState(false)

    const initializationTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
    const [showOutdatedFirmwareMessage, setShowOutdatedFirmwareMessage] = useState<boolean>(false)

    const connectToSerial = async () => {
        try {
            if (navigator.serial) {
                const serialPort = await navigator.serial.requestPort({
                    filters: SplitflapWebSerial.USB_DEVICE_FILTERS,
                })
                serialPort.addEventListener('disconnect', () => {
                    setSplitflap(null)
                })
                const splitflap = new SplitflapWebSerial(serialPort, (message) => {
                    if (message.payload === 'splitflapState' && message.splitflapState !== null) {
                        const state = PB.SplitflapState.create(message.splitflapState)
                        const stateObj = PB.SplitflapState.toObject(state, {
                            defaults: true,
                        }) as NoUndefinedField<PB.ISplitflapState>
                        setSplitflapState(stateObj)
                    } else if (message.payload === 'log' && message.log !== null) {
                        const newLog = message.log?.msg
                        console.log('LOG from splitflap', newLog)
                        if (newLog != null) {
                            const ts = new Date()
                            setSplitflapLogs((cur) => {
                                const newLogs = cur.slice(-30)
                                newLogs.push([ts, newLog])
                                return newLogs
                            })
                        }
                    } else if (message.payload === 'ack') {
                        // Ignore (internal protocol implementation detail)
                    } else if (message.payload === 'generalState' && message.generalState !== null) {
                        const state = PB.GeneralState.create(message.generalState)
                        const stateObj = PB.GeneralState.toObject(state, {
                            defaults: true,
                        }) as NoUndefinedField<PB.IGeneralState>
                        setSplitflapGeneralState(stateObj)

                        const initializationTimeout = initializationTimeoutRef.current;
                        if (initializationTimeout !== undefined) {
                            clearTimeout(initializationTimeout)
                            initializationTimeoutRef.current = undefined;
                            setSplitflap(splitflap)
                        }
                    } else {
                        console.log('Unhandled message type', message);
                    }
                })
                const loop = splitflap.openAndLoop()
                splitflap.sendConfig(PB.SplitflapConfig.create(splitflapConfig))

                // Older firmware did not send general state; use a timeout to determine if we should fall back to legacy mode
                initializationTimeoutRef.current = setTimeout(() => {
                    initializationTimeoutRef.current = undefined
                    console.log('Timed out waiting for initial general state; assuming this is a legacy splitflap connected')
                    setShowOutdatedFirmwareMessage(true)
                    setSplitflap(splitflap)
                }, 500)
                await loop
            } else {
                console.error('Web Serial API is not supported in this browser.')
                setSplitflap(null)
            }
        } catch (error) {
            console.error('Error with serial port:', error)
            setSplitflap(null)
        }
    }

    useEffect(() => {
        if (splitflapGeneralState?.flapCharacterSet !== undefined) {
            console.log('Updating flap character set')
            const flaps = String.fromCharCode(...Array.from(splitflapGeneralState.flapCharacterSet)).split('')
            setFlapCharacterSet(flaps)
        }
    }, [JSON.stringify(splitflapGeneralState?.flapCharacterSet)])

    const [forceFullRotations, setForceFullRotations] = useState<boolean>(true)
    const updateSplitflap = useCallback((value: string, doNotForceFullRotations = false) => {
        // TODO: should probably change types and use applySetFlaps?
        setSplitflapConfig((cur) => {
            const newModules = []
            for (let i = 0; i < splitflapState.modules.length; i++) {
                const targetFlapIndex = value[i] !== undefined ? flapCharacterSet.indexOf(value[i]) : 0
                newModules.push({
                    targetFlapIndex,
                    resetNonce: cur.modules[i]?.resetNonce ?? 0,
                    movementNonce: (cur.modules[i]?.movementNonce ?? 0) + (forceFullRotations && !doNotForceFullRotations ? (targetFlapIndex === 0 ? 0 : 1) : 0),
                })
            }
            return {
                modules: newModules,
            }
        })
    }, [splitflapState.modules])

    const numModules = splitflapState.modules.length
    const charWidth = Math.max(1000 / numModules, 40)

    return (
        <>
            <AppBar position="relative" color="default">
                <Toolbar>
                    <Typography variant="h6" color="inherit" noWrap>
                        Splitflap Web Serial Demo
                    </Typography>
                </Toolbar>
            </AppBar>
            <Container component="main" maxWidth="lg">
                <Card sx={{margin: '32px'}}>
                    <CardContent>
                        {splitflap !== null ? (
                            <>
                                {showOutdatedFirmwareMessage ? (
                                    <Alert
                                        severity="info"
                                        action={
                                            <Button color="inherit" size="small" onClick={() => {
                                                setShowOutdatedFirmwareMessage(false)
                                            }}>
                                                Dismiss
                                            </Button>
                                        }
                                    >
                                        <AlertTitle>Outdated firmware!</AlertTitle>
                                        The connected splitflap device is running outdated firmware; some functionality
                                        may be missing as a result. Please build and upload the latest firmware to the
                                        ESP32.
                                    </Alert>
                                ) : null}
                                {unsavedCalibration ? (
                                    <Alert
                                        severity="warning"
                                        action={
                                            <Button color="inherit" size="small" onClick={() => {
                                                setLogDisplay({
                                                    lastN: 20,
                                                    after: new Date(),
                                                    title: "Saving calibration...",
                                                    body: "Check the logs to confirm the calibration has saved successfully:"
                                                })
                                                setTimeout(() => splitflap.saveAllOffsets(), 200)
                                                setUnsavedCalibration(false)
                                            }}>
                                                SAVE CALIBRATION
                                            </Button>
                                        }
                                    >
                                        <AlertTitle>Unsaved calibration</AlertTitle>
                                        Module calibration has been modified but has not been saved yet. It will be lost
                                        when the ESP32 is restarted.
                                    </Alert>
                                ) : null}
                                <Typography variant="h4" color="inherit">
                                    Current state
                                </Typography>
                                <div style={{}}>
                                    {
                                        splitflapState.modules.map((module, i) => {
                                            return (<SplitflapModuleDisplay
                                                i={i}
                                                module={module}
                                                flapCharacterSet={flapCharacterSet}
                                                charWidth={charWidth}
                                                setSplitflapConfig={setSplitflapConfig}
                                                increaseOffsetTenth={() => splitflap?.offsetIncrementTenth(i)}
                                                increaseOffsetHalf={() => splitflap?.offsetIncrementHalf(i)}
                                                increaseOffsetByTenths={(tenths) => splitflap?.offsetIncrementByTenths(i, tenths)}

                                                goToFlap={(flapIndex) => {
                                                    const update: (number | null)[] = Array(i + 1).fill(null)
                                                    update[i] = flapIndex
                                                    setSplitflapConfig((curConfig) => {
                                                        return PB.SplitflapConfig.toObject(applySetFlaps(PB.SplitflapConfig.create(curConfig), update), {
                                                            defaults: true,
                                                        }) as NoUndefinedField<PB.ISplitflapConfig>
                                                    })
                                                }}
                                                setOffsetToCurrentStep={
                                                    () => {
                                                        splitflap?.offsetSetToCurrentStep(i)
                                                        setUnsavedCalibration(true);
                                                    }
                                                }
                                            />)
                                        })
                                    }
                                </div>
                                <br/>
                                <Typography variant="h4" color="inherit">
                                    Input
                                </Typography>
                                <form onSubmit={(event) => {
                                    event.preventDefault()
                                    updateSplitflap(inputValue.val)
                                    setInputValue({val: '', user: true})
                                }}>
                                    <div style={{
                                        width: `${charWidth * numModules}px`,
                                        overflow: 'hidden',
                                    }}>
                                        <div style={{
                                            left: 0,
                                            position: 'sticky'
                                        }}>
                                            <input
                                                type="text"
                                                maxLength={numModules}
                                                onChange={handleInputChange}
                                                value={inputValue.val}
                                                onBlur={e => e.target.focus()}
                                                spellCheck="false"
                                                style={{
                                                    color: '#333',
                                                    caret: 'block',
                                                    paddingLeft: `${charWidth * 0.12}px`,
                                                    paddingTop: '20px',
                                                    paddingBottom: '20px',
                                                    letterSpacing: `${0.4 * charWidth}px`,
                                                    border: 0,
                                                    outline: 'none',
                                                    backgroundImage: 'url("outline.svg")',
                                                    backgroundSize: `${charWidth}px`,
                                                    backgroundRepeat: 'repeat-x',
                                                    backgroundPosition: `0px ${20 + charWidth * 0.1}px`,
                                                    fontSize: `${charWidth}px`,
                                                    fontFamily: 'Roboto Mono',
                                                    width: `${charWidth * numModules + 50}px`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                </form>
                                <FormControlLabel control={<Checkbox checked={forceFullRotations}
                                                                     onChange={() => setForceFullRotations((cur) => !cur)}/>}
                                                  label="Force full rotations"/>
                                <p>
                                    <Link onClick={() => {
                                        setShowDebugInfo((cur) => !cur)
                                    }}>{showDebugInfo ? <>Hide debug info</> : <>Show debug info</>}</Link>
                                </p>
                                {
                                    showDebugInfo ? (
                                        <>
                                            <Link onClick={() => {
                                                setLogDisplay({lastN: 20, title: "Recent logs", body: ""})
                                            }}>View logs</Link>
                                            <pre>{JSON.stringify(splitflapGeneralState, undefined, 4)}</pre>
                                        </>
                                    ) : null
                                }
                                {logDisplay !== null ? (
                                    <Dialog open={true} onClose={() => setLogDisplay(null)}>
                                        <DialogTitle>{logDisplay.title}</DialogTitle>
                                        <DialogContent>
                                            <DialogContentText>
                                                {logDisplay.body}
                                            </DialogContentText>
                                            <Logs
                                                logs={splitflapLogs}
                                                lastN={20}
                                                after={logDisplay.after}
                                            />
                                        </DialogContent>
                                        <DialogActions>
                                            <Button variant='contained' onClick={() => {
                                                setLogDisplay(null)
                                            }}>Done</Button>
                                        </DialogActions>
                                    </Dialog>
                                ) : null}
                            </>
                        ) : navigator.serial ? (
                            <>
                                <Typography variant="h4" color="inherit">
                                    Welcome
                                </Typography>
                                <Typography variant="body1">
                                    <p>If you have a Splitflap Display built with the Chainlink electronics system and
                                        you have up-to-date firmware installed on it,
                                        you can connect it via USB and control it using this web page. This uses Web
                                        Serial to talk to the device without needing to
                                        install any software on your computer.</p>
                                </Typography>
                                <Button onClick={connectToSerial} variant="contained">
                                    Connect via Web Serial
                                </Button>
                            </>
                        ) : (
                            <Typography>
                                Sorry, Web Serial API isn't available in your browser. Try the latest version of Chrome.
                            </Typography>
                        )}

                        {splitflap === null ?
                            <Typography variant="body1">
                                <p><b>Haven't built a display yet, or want to learn more?</b> Check out the <Link
                                    href="3d_viewer/">project landing page</Link> to see
                                    an interactive 3d model and read more about the project.</p>
                            </Typography>
                            :
                            null
                        }
                    </CardContent>
                </Card>
            </Container>
        </>
    )
}

type SplitflapModuleDisplayProps = {
    charWidth: number,
    i: number,
    flapCharacterSet: string[],
    setSplitflapConfig: React.Dispatch<React.SetStateAction<NoUndefinedField<PB.ISplitflapConfig>>>,
    module: NoUndefinedField<PB.SplitflapState.IModuleState>,
    increaseOffsetTenth: () => void,
    increaseOffsetHalf: () => void,
    increaseOffsetByTenths: (tenths: number) => void,
    goToFlap: (i: number) => void,
    setOffsetToCurrentStep: () => void,
}

enum CalibrationStep {
    FIND_FLAP_BOUNDARY = 0,
    ADJUST_WHOLE_FLAP_OFFSET = 1,
    ADVANCED_ADJUST_FLAP_OFFSET = 2,
    VERIFY_HOME_ADVANCED = 3,
    VERIFY_HOME = 4,
    VERIFY_THIRD = 5,
    VERIFY_TWO_THIRDS = 6,
    FINAL_VERIFY = 7,
    CALIBRATING = 8,
    CONFIRM = 9,
}

const SplitflapModuleDisplay: React.FC<SplitflapModuleDisplayProps> = (props) => {
    const {
        charWidth,
        i,
        flapCharacterSet,
        setSplitflapConfig,
        module,
        increaseOffsetTenth,
        increaseOffsetHalf,
        increaseOffsetByTenths,
        goToFlap,
        setOffsetToCurrentStep
    } = props;

    const [dialogOpen, setDialogOpen] = useState<boolean>(false);
    const [calibrationStep, setCalibrationStep] = useState<CalibrationStep>(CalibrationStep.FIND_FLAP_BOUNDARY);
    const [tenthsOffset, setTenthsOffset] = useState<number>(5); // Default to 5 (half step)
    const [isAdvancedMode, setIsAdvancedMode] = useState<boolean>(false);
    const [rumbleEnabled, setRumbleEnabled] = useState<boolean>(false);
    const [isRumbling, setIsRumbling] = useState<boolean>(false);
    const [currentRumbleIndex, setCurrentRumbleIndex] = useState<number>(0);

    // Effect to handle continuous rumble
    useEffect(() => {
        if (!rumbleEnabled || !isRumbling) {
            return;
        }

        const interval = setInterval(() => {
            setSplitflapConfig((curConfig) => {
                const newModules = [...curConfig.modules];
                // Find all alpha characters in the flap set
                const alphaFlaps = flapCharacterSet
                    .map((char, idx) => ({char, idx}))
                    .filter(({char}) => char.match(/[A-Z]/));

                if (alphaFlaps.length === 0) return curConfig;

                // Update current position in the alpha sequence
                setCurrentRumbleIndex((prev) => (prev + 1) % alphaFlaps.length);

                // Make all other modules go to the next letter
                for (let moduleIndex = 0; moduleIndex < curConfig.modules.length; moduleIndex++) {
                    if (moduleIndex !== i) {
                        newModules[moduleIndex] = {
                            ...newModules[moduleIndex],
                            targetFlapIndex: alphaFlaps[currentRumbleIndex].idx
                        };
                    }
                }
                return {modules: newModules};
            });
        }, 100); // Adjust speed as needed

        return () => clearInterval(interval);
    }, [rumbleEnabled, isRumbling, currentRumbleIndex, flapCharacterSet, i, setSplitflapConfig]);

    // Start/stop rumbling based on calibration state
    useEffect(() => {
        setIsRumbling(rumbleEnabled && dialogOpen);
    }, [rumbleEnabled, dialogOpen]);

    const getThirdPosition = (flapSet: string[]) => Math.floor(flapSet.length / 3);
    const getTwoThirdsPosition = (flapSet: string[]) => Math.floor(2 * flapSet.length / 3);

    const handleVerificationSelection = (offset: -1 | 0 | 1) => {
        if (offset === 0) {
            // Correct flap, move to next step
            console.log(calibrationStep)

            switch (calibrationStep) {
                case CalibrationStep.VERIFY_HOME_ADVANCED:
                    setOffsetToCurrentStep();
                    goToFlap(getThirdPosition(flapCharacterSet));
                    setCalibrationStep(CalibrationStep.VERIFY_THIRD);
                    break;
                case CalibrationStep.VERIFY_THIRD:
                    goToFlap(0);
                    goToFlap(getTwoThirdsPosition(flapCharacterSet));
                    setCalibrationStep(CalibrationStep.VERIFY_TWO_THIRDS);
                    break;
                case CalibrationStep.VERIFY_TWO_THIRDS:
                    goToFlap(0);
                    setCalibrationStep(CalibrationStep.FINAL_VERIFY);
                    break;
                case CalibrationStep.FINAL_VERIFY:
                    setOffsetToCurrentStep();
                    setCalibrationStep(CalibrationStep.CONFIRM);
                    break;
            }
        } else {
            // Wrong flap, adjust offset and restart
            const adjustAmount = offset === -1 ? 1 : -1;
            setTenthsOffset(prev => Math.max(0, Math.min(10, prev + adjustAmount)));
            goToFlap(0);
            setCalibrationStep(CalibrationStep.FIND_FLAP_BOUNDARY);
        }
    };

    const renderFlapOptions = (expectedIndex: number) => {
        const prevFlap = flapCharacterSet[(expectedIndex - 1 + flapCharacterSet.length) % flapCharacterSet.length];
        const expectedFlap = flapCharacterSet[expectedIndex];
        const nextFlap = flapCharacterSet[(expectedIndex + 1) % flapCharacterSet.length];
        return (
            <>
                <Button variant="outlined" onClick={() => handleVerificationSelection(-1)} style={{opacity: 0.7}}>
                    {renderFlapCharacter(prevFlap)}
                </Button>
                <Button variant="contained" onClick={() => handleVerificationSelection(0)}
                        style={{transform: 'scale(1.2)'}}>
                    {renderFlapCharacter(expectedFlap)}
                </Button>
                <Button variant="outlined" onClick={() => handleVerificationSelection(1)} style={{opacity: 0.7}}>
                    {renderFlapCharacter(nextFlap)}
                </Button>
            </>
        );
    };
    const handleTenthsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseInt(event.target.value);
        if (!isNaN(value) && value >= 0 && value <= 10) {
            setTenthsOffset(value);
        }
    };

    const calibrationComponent: Record<CalibrationStep, React.FC<void>> = {
        [CalibrationStep.FIND_FLAP_BOUNDARY]: () =>
            <>
                <DialogContent>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={isAdvancedMode}
                                onChange={(e) => setIsAdvancedMode(e.target.checked)}
                            />
                        }
                        label="Advanced Calibration Mode"
                    />
                    {isAdvancedMode && (
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={rumbleEnabled}
                                    onChange={(e) => setRumbleEnabled(e.target.checked)}
                                />
                            }
                            label="Enable Rumble (Other modules will spin during calibration)"
                        />
                    )}
                    <DialogContentText>
                        Keep clicking this button until the flap flips...
                    </DialogContentText>
                    <Button variant='contained' onClick={() => {
                        increaseOffsetTenth()
                    }}>&gt;&gt;</Button>
                    <br/>
                    <DialogContentText>
                        then click Continue.
                    </DialogContentText>
                    <br/>
                    {isAdvancedMode && (
                        <>
                            <DialogContentText>
                                Adjust offset after flip (default is 5 tenths for a half step):
                            </DialogContentText>
                            <TextField
                                type="number"
                                value={tenthsOffset}
                                onChange={handleTenthsChange}
                                inputProps={{min: 0, max: 10}}
                                size="small"
                                style={{marginTop: '8px', marginBottom: '8px'}}
                            />
                        </>
                    )}
                    <DialogContentText variant='caption'>
                        (If you accidentally go too far, just keep clicking until the next flap flips)
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button variant='outlined' onClick={() => {
                        if (isAdvancedMode) {
                            increaseOffsetByTenths(tenthsOffset);
                            setCalibrationStep(CalibrationStep.ADVANCED_ADJUST_FLAP_OFFSET);
                        } else {
                            increaseOffsetHalf();
                            setCalibrationStep(CalibrationStep.ADJUST_WHOLE_FLAP_OFFSET);
                        }
                    }}>Continue</Button>
                </DialogActions>
            </>,
        [CalibrationStep.ADVANCED_ADJUST_FLAP_OFFSET]: () => <>
            <DialogContent>
                <DialogContentText>
                    Now click the flap that is currently showing
                </DialogContentText>
                {
                    Array.from(flapCharacterSet).map((f) => (
                        <Button
                            key={`button-${f}`}
                            variant='outlined'
                            onClick={() => {
                                goToFlap((flapCharacterSet.length - flapCharacterSet.indexOf(f)) % flapCharacterSet.length)
                                setCalibrationStep(CalibrationStep.VERIFY_HOME_ADVANCED);
                            }}
                        >
                            {renderFlapCharacter(f)}
                        </Button>
                    ))
                }
            </DialogContent>
        </>,
        [CalibrationStep.ADJUST_WHOLE_FLAP_OFFSET]: () => <>
            <DialogContent>
                <DialogContentText>
                    Now click the flap that is currently showing
                </DialogContentText>
                {
                    Array.from(flapCharacterSet).map((f) => (
                        <Button
                            key={`button-${f}`}
                            variant='outlined'
                            onClick={() => {
                                goToFlap((flapCharacterSet.length - flapCharacterSet.indexOf(f)) % flapCharacterSet.length)
                                setCalibrationStep(CalibrationStep.CALIBRATING);
                            }}
                        >
                            {renderFlapCharacter(f)}
                        </Button>
                    ))
                }
            </DialogContent>
        </>,
        [CalibrationStep.VERIFY_HOME_ADVANCED]: () =>
            <>
                <DialogContent>
                    <DialogContentText>
                        Verifying Home Position (Step 1 of 4)
                        <br/>
                        Select the flap character currently displayed:
                    </DialogContentText>
                    <div style={{display: 'flex', justifyContent: 'center', gap: '1rem', margin: '1rem 0'}}>
                        {renderFlapOptions(0)}
                    </div>

                </DialogContent>
                <DialogActions>
                    <Button variant='contained' onClick={() => {
                        setDialogOpen(false)
                    }}>Quit</Button>
                </DialogActions>
            </>,
        [CalibrationStep.VERIFY_TWO_THIRDS]: () =>
            <>
                <DialogContent>
                    <DialogContentText>
                        Verifying 2/3 Position (Step 3 of 4)
                        <br/>
                        Select the flap character currently displayed:
                    </DialogContentText>
                    <div style={{display: 'flex', justifyContent: 'center', gap: '1rem', margin: '1rem 0'}}>
                        {renderFlapOptions(getTwoThirdsPosition(flapCharacterSet))}
                    </div>
                </DialogContent>
                <DialogActions>
                    <Button variant='contained' onClick={() => {
                        setDialogOpen(false)
                    }}>Quit</Button>
                </DialogActions>
            </>,
        [CalibrationStep.FINAL_VERIFY]: () =>
            <>
                <DialogContent>
                    <DialogContentText>
                        Final Home Position Verification (Step 4 of 4)
                        <br/>
                        Select the flap character currently displayed:
                    </DialogContentText>
                    <div style={{display: 'flex', justifyContent: 'center', gap: '1rem', margin: '1rem 0'}}>
                        {renderFlapOptions(0)}
                    </div>
                </DialogContent>
                <DialogActions>
                    <Button variant='contained' onClick={() => {
                        setDialogOpen(false)
                    }}>Quit</Button>
                </DialogActions>
            </>,
        [CalibrationStep.VERIFY_HOME]: () =>
            <>
                <DialogContent>
                    <DialogContentText>
                        Verifying Home Position (Step 1 of 4)
                        <br/>
                        Select the flap character currently displayed:
                    </DialogContentText>
                    <div style={{display: 'flex', justifyContent: 'center', gap: '1rem', margin: '1rem 0'}}>
                        {renderFlapOptions(0)}
                    </div>
                </DialogContent>
                <DialogActions>
                    <Button variant='contained' onClick={() => {
                        setDialogOpen(false)
                    }}>Quit</Button>
                </DialogActions>
            </>,
        [CalibrationStep.VERIFY_THIRD]: () =>
            <>
                <DialogContent>
                    <DialogContentText>
                        Verifying 1/3 Position (Step 2 of 4)
                        <br/>
                        Select the flap character currently displayed:
                    </DialogContentText>
                    <div style={{display: 'flex', justifyContent: 'center', gap: '1rem', margin: '1rem 0'}}>
                        {renderFlapOptions(getThirdPosition(flapCharacterSet))}
                    </div>
                </DialogContent>
                <DialogActions>
                    <Button variant='contained' onClick={() => {
                        setDialogOpen(false)
                    }}>Quit</Button>
                </DialogActions>
            </>,
        [CalibrationStep.CALIBRATING]: () =>
            <>
                {
                    module.moving ? (
                        <DialogContent>
                            <DialogContentText>
                                Calibrating, please wait...
                            </DialogContentText>
                        </DialogContent>
                    ) : (
                        <>
                            <DialogContent>
                                <DialogContentText>
                                    Has the module calibrated to the home position?
                                </DialogContentText>
                            </DialogContent>
                            <DialogActions>
                                <Button variant='outlined' onClick={() => {
                                    goToFlap(0);
                                    setCalibrationStep(CalibrationStep.FIND_FLAP_BOUNDARY)
                                }}>Retry</Button>
                                <Button variant='contained' onClick={() => {
                                    setOffsetToCurrentStep()
                                    setDialogOpen(false)
                                }}>Done</Button>
                            </DialogActions>
                        </>
                    )
                }
            </>,

        [CalibrationStep.CONFIRM]: () =>
            <>
                <DialogContent>
                    <DialogContentText>
                        Calibration complete!
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button variant='outlined' onClick={() => {
                        setCalibrationStep(CalibrationStep.FIND_FLAP_BOUNDARY)
                    }}>Retry</Button>
                    <Button variant='contained' onClick={() => {
                        setDialogOpen(false)
                    }}>Done</Button>
                </DialogActions>
            </>,
    }

    const startCalibration = () => {
        goToFlap(0);
        setCalibrationStep(CalibrationStep.FIND_FLAP_BOUNDARY);
        setDialogOpen(true);
    }

    const onClick = (e: SyntheticEvent) => {
        console.log(e)
        if (e.type === 'click') {
            setSplitflapConfig((curConfig) => {
                return PB.SplitflapConfig.toObject(applyResetModule(PB.SplitflapConfig.create(curConfig), i), {
                    defaults: true,
                }) as NoUndefinedField<PB.ISplitflapConfig>
            })
        } else if (e.type === 'contextmenu') {
            e.preventDefault()
            startCalibration()
        }
    }
    return (
        <div
            key={`reset-${i}`}
            style={{
                fontSize: `${charWidth}px`,
                fontFamily: 'Roboto Mono',
                letterSpacing: `${0.4 * charWidth}px`,
                display: 'inline-block',
                width: `${charWidth}px`,
                cursor: 'pointer',
                border: '1px solid black',
                whiteSpace: 'nowrap',
            }}
        >
            <div
                onClick={onClick}
                onContextMenu={onClick}
            >
                <Tooltip title={
                    <div>
                        <div>State: {PB.SplitflapState.ModuleState.toObject(PB.SplitflapState.ModuleState.create(module), {
                            enums: String,
                        }).state}</div>
                        <div>Missed home: {module.countMissedHome}</div>
                        <div>Unexpected home: {module.countUnexpectedHome}</div>
                        <br/>
                        <div><b>Click to reset module</b></div>
                    </div>
                }>
                    <div
                        style={{
                            width: '100%',
                            paddingLeft: module.state === PB.SplitflapState.ModuleState.State.LOOK_FOR_HOME ? 0 : `${charWidth * 0.12}px`,
                            backgroundColor: module.state === PB.SplitflapState.ModuleState.State.SENSOR_ERROR ? 'orange' : 'inherit',
                            minWidth: module.state,
                            textAlign: 'center',
                        }}
                    >{
                        module.state === PB.SplitflapState.ModuleState.State.NORMAL ?
                            renderFlapCharacter(flapCharacterSet[module.flapIndex]) :
                            module.state === PB.SplitflapState.ModuleState.State.LOOK_FOR_HOME ?
                                <CircularProgress size={charWidth * 0.7}/> :
                                module.state === PB.SplitflapState.ModuleState.State.SENSOR_ERROR ?
                                    <>&nbsp;</> :
                                    'x'
                    }
                    </div>
                </Tooltip>
            </div>
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
                <DialogTitle>Calibrate module</DialogTitle>
                {calibrationComponent[calibrationStep]()}
            </Dialog>
        </div>
    )
}


type LogsProps = {
    logs: LogLine[],
    lastN: number,
    after?: Date,
}

const Logs: React.FC<LogsProps> = (props) => {
    return (
        <pre style={{
            fontSize: "1em",
            lineHeight: "1.2em",
            height: (props.lastN * 1.2) + "em"
        }}>{props.logs.slice(-props.lastN).filter(ll => props.after === undefined || ll[0] > props.after).map((ll => ll[0].toISOString() + ": " + ll[1])).join("\n")}</pre>
    )
}